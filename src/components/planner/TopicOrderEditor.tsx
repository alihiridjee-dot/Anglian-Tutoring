import { useMemo, useState, type ReactNode } from "react";
import { Reorder, motion, useDragControls } from "motion/react";
import { ArrowDown, ArrowUp, CalendarDays, GripVertical, Undo2 } from "lucide-react";
import { SectionHeading, EmptyState, ErrorNote, Spinner } from "@/components/Shared";
import { ProgramDAL, type RoadmapResult } from "@/lib/programDal";
import { orderInputs, reorderTopics } from "@/lib/planner/topicOrder";
import { addWeeks, currentWeekKey, toDateKey, weekKeyToDate, weekRangeLabel } from "@/lib/week";
import type { PlannerCourse } from "@/lib/planner/queries";

function DraggableTopic({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className="premium-card rounded-2xl p-4 flex items-center gap-3 relative"
    >
      <span
        onPointerDown={(event) => {
          if (!disabled) controls.start(event);
        }}
        style={{ touchAction: "none" }}
        className="cursor-grab p-1"
        aria-hidden
      >
        <GripVertical className="size-5 text-muted-foreground" />
      </span>
      {children}
    </Reorder.Item>
  );
}

/** Whole-topic editing only; weekly point divisions are always engine-generated. */
export function TopicOrderEditor({
  data,
  course,
  onSaved,
  onCancel,
}: {
  data: RoadmapResult;
  course: PlannerCourse;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  // An open preview has a stable baseline. The write compares it with the database.
  const [snapshot] = useState(data);
  const [from, setFrom] = useState([currentWeekKey(), data.programStart].sort().at(-1)!);
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
  const weeks: string[] = [];
  for (
    let w = from;
    w < snapshot.examDate && weeks.length < 520;
    w = toDateKey(addWeeks(weekKeyToDate(w), 1))
  )
    weeks.push(w);
  const choices: string[] = [];
  for (
    let w = [currentWeekKey(), snapshot.programStart].sort().at(-1)!;
    w < snapshot.examDate && choices.length < 520;
    w = toDateKey(addWeeks(weekKeyToDate(w), 1))
  )
    choices.push(w);
  const move = (id: string, direction: number) => {
    const next = [...order];
    const at = next.indexOf(id);
    const target = at + direction;
    if (target < 0 || target >= next.length) return;
    [next[at], next[target]] = [next[target], next[at]];
    setChosen(next);
    setAnnouncement(`${byId.get(id)?.title} moved to position ${target + 1}. Calendar updated.`);
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
    <div className="space-y-6 tint-primary">
      <SectionHeading
        title="Make the plan match your school"
        hint="Move whole topics. Your calendar updates as you go."
      />
      <div className="premium-card rounded-2xl p-4 flex flex-wrap justify-between gap-4 items-center">
        <label className="text-sm font-bold space-y-2">
          <span className="block">Change my order from</span>
          <select
            className="premium-card rounded-xl px-3 py-2 max-w-full"
            aria-label="Change order from week"
            value={from}
            disabled={saving}
            onChange={(e) => {
              setFrom(e.target.value);
              setChosen(null);
              setAnnouncement("Start week changed. Calendar updated.");
              setError(null);
            }}
          >
            {choices.map((w) => (
              <option key={w} value={w}>
                {weekRangeLabel(weekKeyToDate(w))}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted-foreground max-w-sm">
          Earlier weeks stay fixed. A topic already underway keeps its earlier work; only its
          remaining teaching moves.
        </p>
      </div>
      {snapshot.needsAck ? (
        <EmptyState
          title="Your plan is still updating"
          body="Open your planner, then come back to change your topic order."
        />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3" aria-label="Topic order">
              <SectionHeading
                title="Your topic order"
                hint="Drag a topic, or use its arrows to move it."
              />
              <button
                type="button"
                className="btn-premium rounded-xl px-3 py-2 text-xs inline-flex gap-2 items-center"
                disabled={saving}
                onClick={() => {
                  setChosen(topics.filter((t) => byId.has(t.topicId)).map((t) => t.topicId));
                  setAnnouncement(
                    "Remaining topics restored to curriculum order. Calendar updated.",
                  );
                }}
              >
                <Undo2 className="size-4" /> Use curriculum order
              </button>
              <Reorder.Group
                axis="y"
                values={order}
                onReorder={(next) => {
                  if (!saving) {
                    setChosen(next);
                    setAnnouncement("Topic order and calendar updated.");
                  }
                }}
                className="space-y-3"
                aria-label="Reorder whole topics"
              >
                {order.map((id, index) => {
                  const topic = byId.get(id)!;
                  const band = future.find((b) => b.topicId === id);
                  const partial =
                    topic.points.length < topics.find((t) => t.topicId === id)!.points.length;
                  return (
                    <DraggableTopic key={id} id={id} disabled={saving}>
                      <span className="numeral text-lg">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm">{topic.title}</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {partial ? "Remaining teaching · " : ""}
                          {band
                            ? `${band.weeks} ${band.weeks === 1 ? "week" : "weeks"}`
                            : "Dates unavailable"}
                        </p>
                        {band && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {weekRangeLabel(weekKeyToDate(band.startWeek))} onwards
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          className="btn-premium rounded-lg p-2"
                          disabled={saving || index === 0}
                          aria-label={`Move ${topic.title} up`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => move(id, -1)}
                        >
                          <ArrowUp className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="btn-premium rounded-lg p-2"
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
            </section>
            <section
              className="space-y-3 lg:sticky lg:top-4 self-start"
              aria-label="Calendar preview"
            >
              <SectionHeading
                title="Your calendar"
                hint="Teaching time stays balanced by topic weight."
              />
              {preview.error ? (
                <ErrorNote error={preview.error} />
              ) : (
                <div
                  className="premium-card rounded-2xl p-4 max-h-[36rem] overflow-y-auto space-y-2"
                  tabIndex={0}
                  aria-label="Preview teaching weeks"
                >
                  {weeks.map((w) => {
                    const band = future.find((b) => b.startWeek <= w && b.endWeek >= w);
                    if (!band) return null;
                    return (
                      <motion.div
                        layout
                        key={w}
                        className="py-3 border-b border-border last:border-0 flex items-start gap-3"
                      >
                        <CalendarDays className="size-4 shrink-0 mt-1" aria-hidden />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {weekRangeLabel(weekKeyToDate(w))}
                          </p>
                          <motion.p
                            key={band.topicId}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="font-bold text-sm mt-1"
                          >
                            {band.title}
                          </motion.p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
          <div className="premium-card tint-slate rounded-2xl p-4 space-y-2 text-sm">
            <h3>What happens when you save</h3>
            <p>
              New learning follows this calendar. Missed work from earlier weeks keeps its original
              place in the catch-up queue. Revision keeps its assessed timing and updates around the
              new plan.
            </p>
            <p className="text-muted-foreground">
              Completed and started work, carried work, and topics you or your tutor assigned stay
              in your saved weeks. These can sit alongside the new learning shown here.
            </p>
          </div>
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error && <ErrorNote error={error} />}
      <div className="premium-card sticky bottom-3 z-10 rounded-2xl p-3 flex flex-wrap gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn-premium px-5 py-2.5 rounded-xl"
        >
          Back to planner
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
          className="btn-solid px-5 py-2.5 rounded-xl"
        >
          {saving ? "Saving your order…" : "Save topic order"}
        </button>
      </div>
      {saving && <Spinner className="py-2" />}
    </div>
  );
}
