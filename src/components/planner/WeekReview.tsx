import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { ErrorNote } from "@/components/Shared";
import {
  WeeklyPlanDAL,
  type WeeklyPlan,
  type PlanPoint,
  type PlanPointOrigin,
} from "@/lib/planner/weeklyPlanDal";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { carryOrigin, type PointCoverage } from "@/lib/planner/coverage";
import { breakCovering } from "@/lib/planner/breaks";
import { studentBreaksQuery } from "@/lib/planner/breakQueries";
import {
  addWeeks,
  currentWeekKey,
  weekKeyToDate,
  toDateKey,
  weekRangeLabel,
} from "@/lib/planner/week";
import { TutorTake } from "./TutorTake";
import { type Activity } from "./useWeekPlan";
import { useWeekVerdicts, useWeeklyCheckin } from "./useWeekReview";
import { CarryForwardBar, LaneReview, LockedCard, WeeklyCheckinForm } from "./WeekReviewParts";

/**
 * The end-of-week feedback area. It reads how the student actually did on this
 * week's spec points (homework + MCQ coverage), reports it **per lane** — the
 * course and the revision are different questions — lets the student say whether
 * they feel ready and send a note to their tutor, and carries whatever is still
 * loose into next week without losing the lane it came from.
 *
 * Two things it deliberately does *not* do:
 *
 *  • It never opens mid-week ({@link reviewLock}). A verdict on an unfinished
 *    week grades work the student still has days to do.
 *  • Reflections never update memory; only assessed work advances FSRS.
 *
 * In `readOnly` mode (the tutor viewing a student) the lock and the self-report
 * are skipped and the student's own reflection is shown in the feedback editor
 * instead; the tutor can still carry weak points forward on their behalf.
 */
export function WeekReview({
  studentId,
  plan,
  points,
  coverage,
  activity,
  subject,
  board,
  level,
  weekStart,
  onChanged,
  readOnly = false,
  examDate,
}: {
  studentId: string;
  plan: WeeklyPlan;
  points: PlanPoint[];
  coverage: Map<string, PointCoverage>;
  /** What practice exists per point — tells "not done" from "nothing was set". */
  activity: Activity;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  weekStart: string;
  onChanged: () => void;
  readOnly?: boolean;
  /** The programme's exam date: nothing can be carried into a week at or after it. */
  examDate?: string;
}) {
  const { summary, lanes, lock, metrics } = useWeekVerdicts({
    points,
    coverage,
    activity,
    weekStart,
  });
  // The tutor is not being marked, so nothing is withheld from them.
  const locked = !readOnly && lock.locked;

  const {
    error: checkinError,
    retry: retryCheckin,
    coveredOk,
    reflection,
    setReflection,
    sentReflection,
    noteState,
    setNoteState,
    busy,
    setBusy,
    report,
    saveNote,
  } = useWeeklyCheckin({ studentId, plan, points, coverage, activity });

  // Loose work goes into the week after this one — or into the current week
  // when this one is further back, since a week that has already passed is
  // nowhere for new work to land. It used to carry from a fortnight ago into
  // last week, where the points were invisible and still owed.
  const nextStart = [toDateKey(addWeeks(weekKeyToDate(weekStart), 1)), currentWeekKey()]
    .sort()
    .at(-1)!;
  const nextWeekLabel = weekRangeLabel(weekKeyToDate(nextStart));
  // Nothing is ever planned at or after the exam date, so there is nothing to carry into.
  const beyondExam = !!examDate && nextStart >= examDate;
  // Nor for a week the student is on a break for.
  const { data: breaks = [] } = useQuery(studentBreaksQuery(studentId));
  const intoBreak = !!breakCovering(breaks, nextStart);
  // A tick is the student's own word that a point is done; it is not carried.
  const ticked = new Set(points.filter((p) => p.done_at).map((p) => p.spec_point_id));
  const loose = summary.toRevisit.filter((id) => !ticked.has(id));

  /**
   * Carry the loose points into next week, each staying in the lane it was in.
   *
   * Everything used to land on `origin: "carried_over"`, which is not a lane —
   * so a shaky *core* point left the core column for the neutral "Added by you"
   * box, and since the year plan gives each spec point exactly one week, it never
   * came back. The lane now rides along and the carry itself is recorded in
   * `carried_from`.
   */
  const carryForward = async () => {
    if (loose.length === 0) return;
    setBusy("carry");
    const carrying = new Set(loose);
    const origins: Record<string, PlanPointOrigin> = {};
    for (const p of points) {
      if (carrying.has(p.spec_point_id)) origins[p.spec_point_id] = carryOrigin(p.origin);
    }
    try {
      const existing = await WeeklyPlanDAL.getPlan(studentId, subject, nextStart);
      if (existing) {
        const added = await WeeklyPlanDAL.addPoints(existing.plan.id, loose, "student", {
          origins,
          carriedFrom: weekStart,
        });
        // Zero means the planner's rules kept every one of them out.
        if (added === 0) {
          toast.error("Those can't be carried forward right now.");
          return;
        }
      } else {
        await WeeklyPlanDAL.savePlan({
          subject,
          board,
          level,
          weekStart: nextStart,
          specPointIds: loose,
          source: readOnly ? "tutor" : "student",
          origins,
          origin: "student",
          carriedFrom: weekStart,
          studentId,
        });
      }
      toast.success(
        `Carried ${loose.length} ${loose.length === 1 ? "point" : "points"} into ${nextWeekLabel}.`,
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't carry those forward — try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {readOnly ? "This week's performance" : "How this week went"}
        </h3>
      </div>

      {locked ? (
        <LockedCard lock={lock} />
      ) : (
        <>
          <div className="space-y-3">
            {lanes.map((g) => (
              <LaneReview
                key={g.lane}
                lane={g.lane}
                summary={g.summary}
                readOnly={readOnly}
                pointCount={g.points.length}
              />
            ))}
          </div>

          {!readOnly && checkinError && <ErrorNote error={checkinError} onRetry={retryCheckin} />}
          {!readOnly && !checkinError && (
            <WeeklyCheckinForm
              coveredOk={coveredOk}
              busy={busy}
              report={report}
              noteState={noteState}
              setNoteState={setNoteState}
              reflection={reflection}
              setReflection={setReflection}
              saveNote={saveNote}
            />
          )}
        </>
      )}

      {/* Ali's take — the personalized-tutoring voice on the week + next week.
          Shown even while the review is locked: it's the tutor talking to the
          student, not a verdict being passed on them. */}
      <TutorTake
        studentId={studentId}
        plan={plan}
        subject={subject}
        board={board}
        level={level}
        weekStart={weekStart}
        isTutor={readOnly}
        onChanged={onChanged}
        metrics={metrics}
        studentReflection={sentReflection || null}
        studentFeltReady={coveredOk}
      />

      {!locked && !beyondExam && !intoBreak && loose.length > 0 && (
        <CarryForwardBar
          count={loose.length}
          busy={busy}
          nextWeekLabel={nextWeekLabel}
          intoThisWeek={nextStart === currentWeekKey()}
          onCarry={carryForward}
        />
      )}
    </div>
  );
}
