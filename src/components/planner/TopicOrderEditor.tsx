import { useMemo, useState, type ReactNode } from "react";
import { Reorder, useDragControls } from "motion/react";
import { ArrowDown, ArrowUp, CalendarDays, GripVertical, Undo2 } from "lucide-react";
import { Chip, SectionHeading, EmptyState, ErrorNote, Spinner } from "@/components/Shared";
import { cn } from "@/lib/utils";
import { ProgramDAL } from "@/lib/planner/programDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { orderInputs, reorderTopics } from "@/lib/planner/topicOrder";
import { currentWeekKey, weekKeyToDate, weekRangeLabel } from "@/lib/planner/week";
import type { PlannerCourse } from "@/lib/planner/queries";
import { TopicCalendar } from "./TopicCalendar";

/**
 * One kit tint per topic, so a topic's number tile in the list and its weeks in
 * the calendar are the same colour. Only the five tints that stay apart side by
 * side: `tint-pop` is too pale to read as text, and `tint-bio`/`tint-emerald`
 * sit on top of `tint-accent`. Past five they repeat, and the number on each run
 * of weeks tells two of the same colour apart.
 */
const TOPIC_TINTS = ["tint-primary", "tint-amber", "tint-chem", "tint-accent", "tint-rose"];
const topicTint = (curriculumIndex: number) => TOPIC_TINTS[curriculumIndex % TOPIC_TINTS.length];

function DraggableTopic({
  id,
  disabled,
  onFocusChange,
  children,
}: {
  id: string;
  disabled: boolean;
  /** Pointing at or tabbing into a card picks its weeks out in the calendar. */
  onFocusChange: (id: string | null) => void;
  children: ReactNode;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      onPointerEnter={() => onFocusChange(id)}
      onPointerLeave={() => onFocusChange(null)}
      onFocus={() => onFocusChange(id)}
      onBlur={() => onFocusChange(null)}
      className="premium-card rounded-2xl p-3 sm:p-4 flex items-center gap-3 relative"
    >
      <span
        onPointerDown={(event) => {
          if (!disabled) controls.start(event);
        }}
        style={{ touchAction: "none" }}
        className="tap-target cursor-grab p-1"
        aria-hidden
      >
        <GripVertical className="size-5 text-muted-foreground" />
      </span>
      {children}
    </Reorder.Item>
  );
}

/**
 * Whole-topic editing only; weekly point divisions are always engine-generated.
 *
 * Voiced to the student by default. A tutor reordering on a student's behalf
 * gets the same editor addressed the right way round — "Alex's school", not
 * "your school" — and the write names the student, which the database
 * accepts from a tutor.
 *
 * Each topic card carries its own dates and colour, and the calendar beside the
 * list paints each topic's weeks in that colour, so a student sees where a topic
 * lands without reading a week-by-week list against the order.
 */
export function TopicOrderEditor({
  data,
  course,
  onSaved,
  onCancel,
  asTutor = false,
  studentName,
}: {
  data: RoadmapResult;
  course: PlannerCourse;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  /** A tutor acting for the student: neutral copy, and the write is on their behalf. */
  asTutor?: boolean;
  studentName?: string | null;
}) {
  const whose = asTutor ? `${studentName ?? "the student"}'s` : "your";
  const Whose = asTutor ? `${studentName ?? "The student"}'s` : "Your";
  // An open preview has a stable baseline. The write compares it with the database.
  const [snapshot] = useState(data);
  // The change always starts this week (or when the programme does).
  const [from] = useState([currentWeekKey(), data.programStart].sort().at(-1)!);
  const topics = useMemo(
    () =>
      snapshot.progress.map((t) => ({
        topicId: t.topicId,
        title: t.title,
        points: t.points.map((p) => ({
          specPointId: p.id,
          code: p.code,
          title: p.title,
          weight: p.weight,
        })),
      })),
    [snapshot],
  );
  const inputs = useMemo(
    () => orderInputs(snapshot.baselineBands, topics, from),
    [snapshot, topics, from],
  );
  const [chosen, setChosen] = useState<string[] | null>(null);
  const order = chosen ?? inputs.remaining.map((t) => t.topicId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const preview = useMemo(() => {
    try {
      return {
        bands: reorderTopics({
          bands: snapshot.baselineBands,
          topics,
          order,
          from,
          examDate: snapshot.examDate,
        }),
        error: null,
      };
    } catch (e) {
      return {
        bands: [],
        error: e instanceof Error ? e : new Error("Unable to build this order."),
      };
    }
  }, [snapshot, topics, order, from]);
  const byId = new Map(inputs.remaining.map((t) => [t.topicId, t]));
  const future = preview.bands.filter((b) => b.startWeek >= from);
  const tintOf = (id: string) => topicTint(topics.findIndex((t) => t.topicId === id));
  const move = (id: string, direction: number) => {
    const next = [...order];
    const at = next.indexOf(id);
    const target = at + direction;
    if (target < 0 || target >= next.length) return;
    [next[at], next[target]] = [next[target], next[at]];
    setChosen(next);
    setAnnouncement(`${byId.get(id)?.title} moved to position ${target + 1}. Dates updated.`);
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await ProgramDAL.reorder({ ...course, data: snapshot, from, order });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Could not save your order."));
      setSaving(false);
    }
  };
  return (
    <div className="space-y-5 tint-primary">
      <SectionHeading
        title={asTutor ? `Make the plan match ${whose} school` : "Make the plan match your school"}
      />
      {snapshot.needsAck ? (
        <EmptyState
          title={`${Whose} plan is still updating`}
          body={
            asTutor
              ? "The plan settles the next time the student opens their planner. Come back to change the topic order after that."
              : "Open your planner, then come back to change your topic order."
          }
        />
      ) : (
        <>
          {preview.error && <ErrorNote error={preview.error} />}
          <div className="grid gap-5 lg:grid-cols-2">
            <Reorder.Group
              axis="y"
              values={order}
              onReorder={(next) => {
                if (!saving) {
                  setChosen(next);
                  setAnnouncement("Topic order and dates updated.");
                }
              }}
              className="space-y-3"
              aria-label={`${Whose} topic order`}
            >
              {order.map((id, index) => {
                const topic = byId.get(id)!;
                const band = future.find((b) => b.topicId === id);
                const partial =
                  topic.points.length < topics.find((t) => t.topicId === id)!.points.length;
                return (
                  <DraggableTopic key={id} id={id} disabled={saving} onFocusChange={setFocus}>
                    <span className={cn("icon-tile numeral size-9 shrink-0 text-base", tintOf(id))}>
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm sm:text-base font-bold leading-snug">{topic.title}</h3>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {band ? (
                          <Chip icon={CalendarDays} tint={tintOf(id)}>
                            {weekRangeLabel(
                              weekKeyToDate(band.startWeek),
                              weekKeyToDate(band.endWeek),
                            )}
                          </Chip>
                        ) : (
                          <Chip tint="tint-slate">Dates unavailable</Chip>
                        )}
                        {partial && <Chip tint="tint-slate">Remaining teaching</Chip>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:gap-1">
                      <button
                        type="button"
                        className="btn-premium rounded-lg p-3.5 sm:pointer-fine:p-2"
                        disabled={saving || index === 0}
                        aria-label={`Move ${topic.title} up`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => move(id, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="btn-premium rounded-lg p-3.5 sm:pointer-fine:p-2"
                        disabled={saving || index === order.length - 1}
                        aria-label={`Move ${topic.title} down`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => move(id, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </button>
                    </div>
                  </DraggableTopic>
                );
              })}
            </Reorder.Group>
            {/* As tall as the list beside it and scrolls within that, so the
                months never push the list's last topics off the page. */}
            <div className="relative lg:min-h-[28rem]">
              <div
                className="premium-card rounded-2xl p-4 overflow-y-auto max-lg:max-h-[30rem] lg:absolute lg:inset-0"
                tabIndex={0}
              >
                <TopicCalendar
                  bands={future}
                  from={from}
                  examDate={snapshot.examDate}
                  tintOf={tintOf}
                  numberOf={(id) => order.indexOf(id) + 1}
                  focus={focus}
                  label={`${Whose} calendar`}
                />
              </div>
            </div>
          </div>
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && <ErrorNote error={error} />}
      {/* On a phone the reset takes the top row and Back/Save share the second,
          so the pinned bar stays two rows tall rather than three. */}
      <div className="premium-card sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 rounded-2xl p-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
        {!snapshot.needsAck && (
          <button
            type="button"
            className="btn-premium col-span-2 px-3 sm:px-5 py-2.5 min-h-11 sm:pointer-fine:min-h-0 rounded-xl inline-flex gap-2 items-center justify-center text-sm sm:text-base"
            disabled={saving}
            onClick={() => {
              setChosen(topics.filter((t) => byId.has(t.topicId)).map((t) => t.topicId));
              setAnnouncement("Remaining topics restored to curriculum order. Dates updated.");
            }}
          >
            <Undo2 className="size-4" /> Use curriculum order
          </button>
        )}
        <div className="contents sm:flex sm:flex-wrap sm:gap-3 sm:ml-auto">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="btn-premium px-3 sm:px-5 py-2.5 min-h-11 sm:pointer-fine:min-h-0 rounded-xl text-sm sm:text-base"
          >
            {asTutor ? "Close" : "Back to planner"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={
              saving ||
              !!preview.error ||
              snapshot.needsAck ||
              order.every((id, i) => id === inputs.remaining[i]?.topicId)
            }
            className="btn-solid px-3 sm:px-5 py-2.5 min-h-11 sm:pointer-fine:min-h-0 rounded-xl text-sm sm:text-base"
          >
            {saving ? (asTutor ? "Saving the order…" : "Saving your order…") : "Save topic order"}
          </button>
        </div>
      </div>
      {saving && <Spinner className="py-2" />}
    </div>
  );
}
