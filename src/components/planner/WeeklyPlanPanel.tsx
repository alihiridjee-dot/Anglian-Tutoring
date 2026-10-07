import { WeekBreakdown } from "./WeekBreakdown";
import { WithheldPlanPoints } from "./WithheldPlanPoints";
import { ErrorNote, EmptyState as KitEmptyState } from "@/components/Shared";
import { useMemo } from "react";
import { toast } from "sonner";
import { CalendarRange, ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import { WeeklyPlanDAL, type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { type Enrolment } from "@/lib/profile/enrolment";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { currentWeekKey, mondayOf, addWeeks, toDateKey, weekRangeLabel } from "@/lib/planner/week";
import { carryOrigin } from "@/lib/planner/coverage";
import { ThisWeekPanel } from "./ThisWeekPanel";
import { DoNowPanel } from "./DoNowPanel";
import { useWeekPlan } from "./useWeekPlan";
import { useReviewMore } from "./useReviewMore";
import { PausedWeek } from "./PausedWeek";
import { BreakWeek } from "./BreakWeek";
import { PastWeek } from "./PastWeek";
import { useActiveSubject } from "@/hooks/useActiveSubject";
import { useNow } from "@/hooks/useNow";
import { useEntryState } from "@/hooks/useEntryState";

/**
 * The dashboard's "this week": the header slider's subject, with week
 * navigation around the shared {@link ThisWeekPanel}, with the end-of-week review as its own box
 * underneath rather than buried at the bottom of the plan.
 *
 * The week itself needs no asking for — it's this week's slice of the year-long
 * programme and builds itself (see {@link useWeekPlan}). The student doesn't
 * shape it: the plan is the course, and the only thing they change about it is
 * ticking work off.
 */
export function WeeklyPlanPanel({
  studentId,
  enrolments,
  level,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
}) {
  const ordered = useMemo(
    () => [
      ...enrolments.filter((e) => e.subject === "biology"),
      ...enrolments.filter((e) => e.subject !== "biology"),
    ],
    [enrolments],
  );
  const { subject: activeSubject } = useActiveSubject();
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];

  // 0 = this week, -1 = last week, +1 = next week… Kept with the visit, so
  // Back from a task opened in another week comes back to that week.
  const [weekOffset, setWeekOffset] = useEntryState("dashboard.week", 0);
  // Re-read each minute, so a tab left open over Sunday midnight moves on to
  // the new week instead of ticking and planning into the one that has ended.
  const now = useNow(60_000);
  const monday = mondayOf(new Date(now));
  const weekStart = toDateKey(addWeeks(monday, weekOffset));
  const weekLabel = weekRangeLabel(addWeeks(monday, weekOffset));
  const isCurrent = weekOffset === 0;
  const isPast = weekOffset < 0;
  const isFuture = weekOffset > 0;
  const editable = !isPast; // history is read-only (but you can pull points forward)
  const showReview = weekOffset <= 0; // review current + past weeks

  const week = useWeekPlan({
    studentId,
    subject: (active?.subject ?? "biology") as SubjectV,
    board: (active?.board ?? "edexcel") as BoardV,
    level,
    weekStart,
    isCurrent,
    withCoverage: showReview,
    // A student with a level but no enrolment rows has no course to plan: the
    // fallback subject above must never be generated, saved or paid for.
    enabled: !!active,
  });
  const reviewMore = useReviewMore({ ...week, isCurrent });
  // A paused subject's week is frozen: shown as paused, with nothing to press.
  // So is a week the student is on a break for.
  const frozen = !!week.pause && !isPast;
  // The arrows stop at the plan's edges: before the programme there is nothing
  // to show, and nothing is ever planned at or after the exam date. Forty taps
  // used to land a student in the July after their exams, told to wait for a
  // review that could never come.
  const nextStart = toDateKey(addWeeks(monday, weekOffset + 1));
  const atExam = !!week.roadmap && nextStart >= week.roadmap.examDate;
  const atStart = !!week.roadmap && weekStart <= week.roadmap.programStart;
  const resting = !frozen && !!week.onBreak && !isPast;

  // Pull a past-week point back into this week's plan, in the lane it was in —
  // the same rule the end-of-week carry follows ({@link carryOrigin}).
  const focusAgain = async (point: PlanPoint) => {
    if (!active) return;
    const curStart = currentWeekKey();
    const origin = carryOrigin(point.origin);
    try {
      const cur = await WeeklyPlanDAL.getPlan(studentId, active.subject as SubjectV, curStart);
      if (cur) {
        const added = await WeeklyPlanDAL.addPoints(cur.plan.id, [point.spec_point_id], origin, {
          carriedFrom: weekStart,
        });
        // Zero means the planner's rules kept it out — a review with nothing
        // assessed behind it, say. Saying "added" then would be a lie.
        if (added === 0) {
          toast.error(`“${point.code}” can't go back into this week right now.`);
          return;
        }
      } else {
        await WeeklyPlanDAL.savePlan({
          subject: active.subject as SubjectV,
          board: active.board as BoardV,
          level,
          weekStart: curStart,
          specPointIds: [point.spec_point_id],
          source: "student",
          origin,
          carriedFrom: weekStart,
        });
      }
      // The current week (cached for a minute) and the backlog both changed.
      await week.reload();
      toast.success(`Added “${point.code}” back into this week.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add that back — try again.");
    }
  };

  if (!active) return null;

  if (week.error) return <ErrorNote error={week.error} onRetry={() => void week.reload()} />;
  return (
    <>
      <div data-guide="week-plan" className="rounded-2xl premium-card p-4 sm:p-5 shadow-sm mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="icon-tile inline-flex w-9 h-9 shrink-0">
              <CalendarRange className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-lg font-extrabold sm:text-xl">
                  {isCurrent ? "This week" : isPast ? "Past week" : "Upcoming week"}
                </h2>
                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => setWeekOffset(0)}
                    className="tap-target inline-flex items-center gap-1 h-5 px-2 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <Undo2 className="w-3 h-3" /> Today
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{weekLabel}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {isCurrent && week.plan && !week.loading && (
              <WeekBreakdown
                id="week-breakdown"
                points={week.points}
                roadmap={week.roadmap}
                weekStart={weekStart}
              />
            )}
            <div className="flex items-center gap-2 sm:gap-1">
              <button
                type="button"
                onClick={() => setWeekOffset((w) => w - 1)}
                disabled={atStart}
                className="size-11 sm:pointer-fine:size-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Previous week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setWeekOffset((w) => w + 1)}
                disabled={atExam}
                className="size-11 sm:pointer-fine:size-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {frozen && week.pause ? (
          <PausedWeek subject={active.subject} pause={week.pause} canManage />
        ) : resting && week.onBreak ? (
          <BreakWeek brk={week.onBreak} />
        ) : !week.loading && week.pastGap ? (
          // A week gone by that was empty on purpose: a break, a pause, or
          // the course before a board or level change.
          <PastWeek gap={week.pastGap} subject={active.subject} own />
        ) : !week.loading && week.points.length === 0 && !week.roadmap ? (
          editable ? (
            <EmptyState future={isFuture} />
          ) : (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No plan was set for this week.
            </p>
          )
        ) : (
          <ThisWeekPanel
            plan={week.plan}
            points={week.points}
            activity={week.activity}
            coverage={week.coverage}
            roadmap={week.roadmap}
            loading={week.loading}
            weekStart={weekStart}
            isPast={isPast}
            showCoverage={showReview}
            onFocusAgain={focusAgain}
            reviewMore={reviewMore}
          />
        )}
      </div>

      {!frozen && !resting && week.pastGap?.kind !== "old-course" && (
        <WithheldPlanPoints points={week.withheld} coverage={week.coverage} />
      )}

      {/* The week as a checklist, under the plan: the panel above says what this
          week is and why, this one says what to press. */}
      {!frozen && !resting && (
        <DoNowPanel
          points={week.points}
          activity={week.activity}
          coverage={week.coverage}
          subject={active?.subject ?? "biology"}
          editable={editable}
          onToggle={(id, done) => {
            void week.setPointDone(id, done);
          }}
        />
      )}
    </>
  );
}

/**
 * Shown when the week has nothing and the programme has nothing to give it —
 * no curriculum came back for this course. The old copy told the student to
 * "sort a few topics", a flow that no longer exists, so the one thing they
 * can actually check — their subject and board — is what it points at now.
 */
function EmptyState({ future }: { future: boolean }) {
  return (
    <KitEmptyState
      title={future ? "Nothing planned for this week yet" : "No plan for this week yet"}
      body={
        future
          ? "This week fills itself from your course plan when it comes round."
          : "Your week builds itself from your course plan. If nothing appears, check your subject and exam board are right."
      }
      action={future ? undefined : { to: "/billing", label: "Check my subjects" }}
    />
  );
}
