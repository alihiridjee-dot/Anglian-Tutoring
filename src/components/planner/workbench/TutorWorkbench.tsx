import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorNote,
  Ring,
  SegmentedToggle,
  Spinner,
  SubjectToggle,
} from "@/components/Shared";
import { SpecPointSelect } from "@/components/tutor/SpecPointSelect";
import { CHAT_KEY, useTutorDirectory } from "@/hooks/data/useChat";
import { useStudentDirectory } from "@/hooks/data/useStudents";
import { type BoardV, type SubjectV } from "@/lib/curriculum/taxonomy";
import { studentBreaksQuery } from "@/lib/planner/breakQueries";
import { NeedsYouDAL } from "@/lib/planner/needsYouDal";
import { describeChange, PlanChangesDAL } from "@/lib/planner/planChangesDal";
import { PlanOverridesDAL } from "@/lib/planner/planOverridesDal";
import { invalidatePlanner, plannerKey } from "@/lib/planner/queries";
import { shortDayLabel } from "@/lib/planner/week";
import { cn } from "@/lib/utils";
import { CoveredLedger } from "../CoveredLedger";
import { PausedWeek } from "../PausedWeek";
import { TopicOrderEditor } from "../TopicOrderEditor";
import { OverridesPanel, OverridesUnavailable } from "../TutorPlannerParts";
import { assignmentWarnings, WARNING_COPY } from "../tutorWeekRows";
import { type TutorPlannerState } from "../useTutorPlanner";
import { WeekSwitcher } from "../WeekSwitcher";
import { WithheldPlanPoints } from "../WithheldPlanPoints";
import { formatSchedule } from "../fullPlan/formatSchedule";
import { BulkActions, describeOutcome, type BulkOutcome } from "./bulkActions";
import { CTRL, QUIET, SOLID, Tally } from "./figures";
import { gridMonths, topicRows, type GridRow, type GridWeek, type Show } from "./gridData";
import { ChangesPanel } from "./ChangesPanel";
import { NeedsYou, type Need } from "./NeedsYou";
import { PlanGrid } from "./PlanGrid";
import { TopicOrderPanel } from "./TopicOrderPanel";
import { WeekReviewPanel } from "./WeekReviewPanel";

type View = "plan" | "review" | "history" | "changes";
const VIEWS: { value: View; label: string }[] = [
  { value: "plan", label: "Plan" },
  { value: "review", label: "Week review" },
  { value: "history", label: "Practice history" },
  { value: "changes", label: "Changes" },
];
/** A phone shows one part at a time: one of the main views, or one of the two beside them. */
type Solo = "main" | "needs" | "order";

const reasonOf = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

/**
 * One student as a tutor works on them (Ali's design, Nov 2026): the plan is
 * the work surface, with what the student needs and the topic order beside it.
 *
 * - **Plan**: the course a month at a time, each week's lines under their lane.
 *   Lines are ticked and then moved, removed or skipped together; points are
 *   added to any week still to come.
 * - **Needs you**: the student's unanswered check-ins and messages, answered in
 *   place, and the work they have missed.
 * - **Topic order**: the topics as they will be taught, and the way into the
 *   order editor.
 * - **Week review** and **Practice history** are one switch away.
 *
 * It reads the planner's state ({@link TutorPlannerState}) and changes the plan
 * through the database's own rules for a tutor's change (remove, skip, pin),
 * called once per line.
 */
export function TutorWorkbench({ state }: { state: TutorPlannerState }) {
  const { student, ordered, active, activeSubject, setSubject, selectStudent } = state;
  const { course, roadmap, weekStart, currentWeek } = state;
  const client = useQueryClient();
  const studentId = student?.id ?? "";
  const ready = !!student && !!active && !!student.level;

  const [view, setView] = useState<View>("plan");
  const [solo, setSolo] = useState<Solo>("needs");
  const [show, setShow] = useState<Show>("all");
  const [month, setMonth] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingWeek, setAddingWeek] = useState<GridWeek | null>(null);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [needBusy, setNeedBusy] = useState<string | null>(null);

  const breaks = useQuery({ ...studentBreaksQuery(studentId), enabled: ready });
  const directory = useStudentDirectory();
  const needsKey = [...plannerKey(studentId), "needs-you", course.subject];
  const staff = useTutorDirectory();
  // Read when the tab is opened, and again after any change to the plan.
  const changes = useQuery({
    queryKey: [...plannerKey(studentId), "changes", course.subject],
    queryFn: () => PlanChangesDAL.list(studentId, course.subject),
    enabled: ready && view === "changes",
    staleTime: 30_000,
  });
  const waiting = useQuery({
    queryKey: needsKey,
    queryFn: () => NeedsYouDAL.list(studentId, course.subject),
    enabled: ready,
    staleTime: 30_000,
  });

  const schedule = useMemo(
    () => (roadmap ? formatSchedule(roadmap, { now: currentWeek, showHistory: true }) : null),
    [roadmap, currentWeek],
  );
  const canChange = state.overridesAvailable === true && !state.week.pause;
  const months = useMemo(
    () =>
      schedule && roadmap
        ? gridMonths({
            months: schedule.months,
            now: currentWeek,
            progress: roadmap.progress,
            backlog: roadmap.backlog,
            completed: roadmap.completedPointIds ?? [],
            breaks: breaks.data ?? [],
            // The week in view is read in full once it has loaded.
            detail: state.loading
              ? null
              : {
                  weekStart,
                  rows: state.rows,
                  coverage: state.coverage,
                  activity: state.activity,
                  opened: state.plan?.source === "ai",
                },
            canChange,
          })
        : [],
    [
      schedule,
      roadmap,
      currentWeek,
      breaks.data,
      state.loading,
      weekStart,
      state.rows,
      state.coverage,
      state.activity,
      state.plan,
      canChange,
    ],
  );
  const topics = useMemo(
    () => (roadmap ? topicRows(roadmap.baselineBands, currentWeek) : []),
    [roadmap, currentWeek],
  );

  if (!student) return null;
  const name = student.name ?? "This student";
  const first = name.split(" ")[0];
  const courseLabel = [student.level?.replace(/_/g, " ").toUpperCase(), active?.board.toUpperCase()]
    .filter(Boolean)
    .join(" · ");
  const lastOn = directory.data?.find((s) => s.id === student.id);
  const lastSeen = lastOn?.last_active_at ?? lastOn?.last_sign_in_at ?? null;

  /** After any change: the planner's data is read again, here and in the roster. */
  const refresh = async () => {
    await invalidatePlanner(client, studentId);
    await state.refreshAll();
  };

  /** Run one action over the ticked lines and say once how it went. */
  const change = async (
    verb: Parameters<typeof describeOutcome>[0],
    work: () => Promise<BulkOutcome>,
    where?: string,
  ) => {
    setBusy(true);
    try {
      const said = describeOutcome(verb, await work(), first, where);
      (said.ok ? toast.success : toast.error)(said.text);
    } catch (e) {
      toast.error(reasonOf(e, "That didn't save. Try again."));
    } finally {
      await refresh();
      setBusy(false);
    }
  };
  const lines = (rows: GridRow[]) =>
    rows.map((row) => ({ specPointId: row.specPointId, code: row.code, week: row.week }));
  const datesOf = (week: string) =>
    months.flatMap((m) => m.weeks).find((w) => w.key === week)?.dates ?? "that week";

  const warnings = addingWeek
    ? assignmentWarnings({
        specPointIds: toAdd,
        roadmap,
        // Only the week in view has its saved lines to hand.
        saved: addingWeek.key === weekStart ? state.points : [],
        overrides: state.overrides,
      })
    : [];
  const closeAdd = () => {
    setAddingWeek(null);
    setToAdd([]);
  };
  const add = async () => {
    if (!addingWeek || !student.level || !active || toAdd.length === 0) return;
    setBusy(true);
    try {
      await PlanOverridesDAL.pin({
        studentId: student.id,
        subject: active.subject as SubjectV,
        board: active.board as BoardV,
        level: student.level,
        weekStart: addingWeek.key,
        specPointIds: toAdd,
      });
      toast.success(
        `Added ${toAdd.length} spec ${toAdd.length === 1 ? "point" : "points"} to ${addingWeek.dates}.`,
      );
      closeAdd();
    } catch (e) {
      toast.error(reasonOf(e, "Couldn't add those. Try again."));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const items = waiting.data ?? [];
  const showMissed = () => {
    setShow("missed");
    setMonth(
      months.find((m) => m.weeks.some((w) => w.rows.some((row) => row.missed)))?.key ?? null,
    );
    setView("plan");
    setSolo("main");
  };
  const needs: Need[] = [
    ...items.map((item): Need => ({
      id: item.id,
      kind: item.kind,
      when: shortDayLabel(new Date(item.at)),
      text: item.text,
      canReply: true,
    })),
    ...(schedule?.attention.missed ?? []).map((topic): Need => ({
      id: `missed:${topic.topicId}`,
      kind: "missed",
      when: `Since ${topic.since}`,
      text: `${topic.specPointIds.length} ${topic.specPointIds.length === 1 ? "point" : "points"} in ${topic.title}`,
      action: { label: "Show in the plan", run: showMissed },
    })),
    ...(schedule?.attention.overload
      ? [
          {
            id: "plan:overload",
            kind: "plan",
            when: "Now",
            text: "The plan doesn't fit before the exams.",
          } satisfies Need,
        ]
      : []),
    ...(schedule && schedule.attention.heldCount > 0
      ? [
          {
            id: "plan:held",
            kind: "plan",
            when: "Now",
            text: `${schedule.attention.heldCount} missed ${schedule.attention.heldCount === 1 ? "point" : "points"} won't fit before the exams at the catch-up pace.`,
          } satisfies Need,
        ]
      : []),
    ...(schedule?.attention.moved
      ? [
          {
            id: "plan:moved",
            kind: "plan",
            when: "Waiting",
            text: `The plan has changed. It applies when ${first} next opens their planner.`,
          } satisfies Need,
        ]
      : []),
  ];
  /** Deal with one waiting item, then read the list (and the bell) again. */
  const settleNeed = async (need: Need, work: () => Promise<void>, done: string) => {
    setNeedBusy(need.id);
    try {
      await work();
      toast.success(done);
      await Promise.all([
        invalidatePlanner(client, studentId),
        client.invalidateQueries({ queryKey: CHAT_KEY }),
      ]);
      return true;
    } catch (e) {
      toast.error(reasonOf(e, "That didn't save. Try again."));
      return false;
    } finally {
      setNeedBusy(null);
    }
  };
  const itemOf = (need: Need) => items.find((item) => item.id === need.id);

  const main = !active ? (
    <EmptyState compact title={`${name} has no subject enrolments yet`} />
  ) : !student.level ? (
    <EmptyState
      compact
      title={`${name} has no exam level set`}
      body="Set it on their profile before planning."
    />
  ) : view === "changes" ? (
    <div className="premium-card p-3 sm:p-4">
      {changes.error ? (
        <ErrorNote error={changes.error} onRetry={() => void changes.refetch()} />
      ) : !changes.data ? (
        <Spinner className="py-10" />
      ) : (
        <ChangesPanel
          changes={changes.data.map((change) => ({
            id: change.id,
            at: change.at,
            kind: change.kind,
            text: describeChange(change, {
              point: (id) => {
                const label = state.labels.get(id);
                return label ? `${label.code} ${label.title}` : null;
              },
              staff: (id) => staff.data?.find((t) => t.id === id)?.display_name ?? null,
              student: first,
            }),
          }))}
        />
      )}
    </div>
  ) : view === "history" ? (
    <div className="premium-card p-3 sm:p-4">
      <CoveredLedger
        studentId={student.id}
        enrolments={student.enrolments}
        level={student.level}
        subject={active.subject}
        canRetake
      />
    </div>
  ) : view === "review" ? (
    <div className="premium-card space-y-4 p-3 sm:p-4">
      <WeekSwitcher
        weekStart={weekStart}
        currentWeek={currentWeek}
        onShift={state.shiftWeek}
        onToday={() => state.setWeek(currentWeek)}
      />
      {state.loading ? (
        <Spinner className="py-10" />
      ) : state.showReview && state.plan ? (
        <WeekReviewPanel
          studentId={student.id}
          firstName={first}
          plan={state.plan}
          points={state.points}
          coverage={state.coverage}
          activity={state.activity}
          subject={active.subject as SubjectV}
          board={active.board as BoardV}
          level={student.level}
          weekStart={weekStart}
          onChanged={() => void state.refreshAll()}
        />
      ) : (
        <EmptyState compact title={`Nothing to review for ${state.weekLabel}`} />
      )}
    </div>
  ) : !roadmap || !schedule ? (
    state.loading ? (
      <div className="premium-card">
        <Spinner className="py-10" label="Loading the plan" />
      </div>
    ) : (
      <EmptyState
        compact
        title="No curriculum for this course yet"
        body="Its spec points haven't been loaded, so there is nothing to plan."
      />
    )
  ) : state.orderEditorOpen ? (
    <div className="premium-card p-3 sm:p-4">
      <TopicOrderEditor
        data={roadmap}
        course={course}
        asTutor
        studentName={student.name}
        onCancel={() => state.setOrderEditorOpen(false)}
        onSaved={async () => {
          await state.reload();
          toast.success(`Topic order saved for ${name}.`);
          state.setOrderEditorOpen(false);
        }}
      />
    </div>
  ) : (
    <div className="space-y-3">
      {state.week.pause && <PausedWeek subject={active.subject} pause={state.week.pause} />}
      {state.overridesAvailable === false && <OverridesUnavailable />}
      <PlanGrid
        months={months}
        month={month}
        onMonth={setMonth}
        show={show}
        onShow={setShow}
        busy={busy}
        onMove={(rows, week) =>
          void change(
            "Moved",
            () => BulkActions.move(course, lines(rows), week),
            `to ${datesOf(week)}`,
          )
        }
        onRemove={(rows) => void change("Removed", () => BulkActions.remove(course, lines(rows)))}
        onSkip={(rows) => void change("Skipped", () => BulkActions.skip(course, lines(rows)))}
        onAdd={(week) => {
          setAddingWeek(week);
          setToAdd([]);
        }}
        addingWeek={addingWeek?.key ?? null}
        addSlot={
          addingWeek && (
            <div className="space-y-2">
              <SpecPointSelect
                subject={active.subject as SubjectV}
                board={active.board as BoardV}
                level={student.level}
                value={toAdd}
                onChange={setToAdd}
              />
              {warnings.length > 0 && (
                <div className="tint-amber border-l-4 border-[var(--tint)] pl-3 text-sm">
                  <b>
                    {warnings.length === 1 ? "One of these" : `${warnings.length} of these`} may not
                    need setting
                  </b>
                  <ul>
                    {warnings.map((w) => (
                      <li key={w.specPointId}>
                        <b>{w.code}</b> {w.title}: {WARNING_COPY[w.reason](w)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={SOLID}
                  disabled={busy || toAdd.length === 0}
                  onClick={() => void add()}
                >
                  <Plus className="size-4" aria-hidden />
                  {warnings.length > 0 ? "Add anyway" : "Add"} to {addingWeek.dates}
                </button>
                <button type="button" className={QUIET} onClick={closeAdd}>
                  Cancel
                </button>
              </div>
            </div>
          )
        }
        footer={
          <div className="space-y-4">
            <OverridesPanel state={state} />
            {state.week.pastGap?.kind !== "old-course" && (
              <WithheldPlanPoints points={state.week.withheld} coverage={state.week.coverage} />
            )}
          </div>
        }
      />
    </div>
  );

  const pick = (to: Solo, v?: View) => {
    setSolo(to);
    if (v) setView(v);
  };
  const PARTS: { key: string; label: string; on: boolean; go: () => void }[] = [
    { key: "needs", label: "Needs you", on: solo === "needs", go: () => pick("needs") },
    ...VIEWS.map((v) => ({
      key: v.value,
      label: v.label,
      on: solo === "main" && view === v.value,
      go: () => pick("main", v.value),
    })),
    { key: "order", label: "Topic order", on: solo === "order", go: () => pick("order") },
  ];

  return (
    <section aria-label={name} className="min-w-0 space-y-3">
      {/* Who, which course, and where they stand. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <button type="button" onClick={() => selectStudent(null)} className={CTRL}>
          <ArrowLeft className="size-4" aria-hidden /> Students
        </button>
        <h2 className="text-xl font-extrabold">{name}</h2>
        {courseLabel && <b>{courseLabel}</b>}
        {ordered.length > 1 && (
          <SubjectToggle
            subjects={ordered.map((e) => e.subject)}
            value={activeSubject}
            onChange={setSubject}
            layoutId="workbench-subject"
          />
        )}
        {schedule && (
          <>
            <span className="whitespace-nowrap">
              Exams <b>{schedule.summary.examDate}</b>
            </span>
            <Tally
              n={schedule.summary.weeksLeft}
              word={schedule.summary.weeksLeft === 1 ? "week to go" : "weeks to go"}
            />
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Ring
                value={schedule.summary.percent}
                size={32}
                stroke={3.5}
                className="tint-emerald"
              >
                <span className="numeral text-xs">{schedule.summary.covered}</span>
              </Ring>
              of {schedule.summary.total} topics covered
            </span>
          </>
        )}
        {lastSeen && (
          <span className="hidden whitespace-nowrap lg:inline">
            Last on <b>{shortDayLabel(new Date(lastSeen))}</b>
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="hidden lg:block">
            <SegmentedToggle
              layoutId="workbench-view"
              label="View"
              value={view}
              onChange={(v) => setView(v as View)}
              items={VIEWS}
            />
          </div>
        </div>
      </header>

      {/* A phone: one part at a time. */}
      <div role="tablist" aria-label="Parts" className="flex gap-1.5 overflow-x-auto lg:hidden">
        {PARTS.map((part) => (
          <button
            key={part.key}
            type="button"
            role="tab"
            aria-selected={part.on}
            onClick={part.go}
            className={cn(
              part.on ? "btn-solid" : "btn-soft",
              "min-h-11 shrink-0 rounded-lg px-3 text-sm",
            )}
          >
            {part.label}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className={cn("min-w-0 lg:block", solo !== "main" && "hidden")}>{main}</div>
        <aside className="space-y-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto">
          <div className={cn("min-w-0 lg:block", solo !== "needs" && "hidden")}>
            <NeedsYou
              needs={needs}
              busy={needBusy}
              onReply={(need, words) => {
                const item = itemOf(need);
                if (!item) return Promise.resolve(false);
                return settleNeed(
                  need,
                  () => NeedsYouDAL.reply(student.id, item, words),
                  item.planId
                    ? `Saved as your note on that week. ${first} sees it on their planner.`
                    : "Sent.",
                );
              }}
              onSettle={(need) => {
                const item = itemOf(need);
                if (item)
                  void settleNeed(need, () => NeedsYouDAL.settle(student.id, item), "Cleared.");
              }}
            />
            {needs.length === 0 && !waiting.isLoading && (
              <div className="lg:hidden">
                <EmptyState compact title="Nothing needs you" />
              </div>
            )}
          </div>
          <div className={cn("min-w-0 lg:block", solo !== "order" && "hidden")}>
            <TopicOrderPanel
              topics={topics}
              percent={schedule?.summary.percent ?? 0}
              onChange={
                !schedule || schedule.replanPending
                  ? null
                  : () => {
                      state.setOrderEditorOpen(true);
                      pick("main", "plan");
                    }
              }
            />
          </div>
        </aside>
      </div>
    </section>
  );
}
