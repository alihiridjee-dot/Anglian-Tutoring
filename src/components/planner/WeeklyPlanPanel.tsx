import { WithheldPlanPoints } from "./WithheldPlanPoints";
import { ErrorNote } from "@/components/Shared";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles, CalendarRange, ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import { WeeklyPlanDAL, type PlanPoint } from "@/lib/weeklyPlanDal";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey, mondayOf, addWeeks, toDateKey, weekRangeLabel } from "@/lib/week";
import { carryOrigin } from "@/lib/planner/coverage";
import { ThisWeekPanel } from "./ThisWeekPanel";
import { DoNowPanel } from "./DoNowPanel";
import { useWeekPlan } from "./useWeekPlan";
import { WeekReview } from "./WeekReview";
import { subjectLabel } from "@/lib/courseSummary";

/**
 * The dashboard's "this week": subject tabs and week navigation around the
 * shared {@link ThisWeekPanel}, with the end-of-week review as its own box
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
  const [activeSubject, setActiveSubject] = useState(ordered[0]?.subject ?? "biology");
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];

  // 0 = this week, -1 = last week, +1 = next week…
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = toDateKey(addWeeks(mondayOf(), weekOffset));
  const weekLabel = weekRangeLabel(addWeeks(mondayOf(), weekOffset));
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
  });

  // Pull a past-week point back into this week's plan, in the lane it was in —
  // the same rule the end-of-week carry follows ({@link carryOrigin}).
  const focusAgain = async (point: PlanPoint) => {
    if (!active) return;
    const curStart = currentWeekKey();
    const origin = carryOrigin(point.origin);
    try {
      const cur = await WeeklyPlanDAL.getPlan(studentId, active.subject as SubjectV, curStart);
      if (cur) {
        await WeeklyPlanDAL.addPoints(cur.plan.id, [point.spec_point_id], origin, {
          carriedFrom: weekStart,
        });
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
      toast.success(`Added “${point.code}” back into this week.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add that back — try again.");
    }
  };

  if (!active) return null;

  if (week.error) return <ErrorNote error={week.error} />;
  return (
    <>
      <div className="rounded-2xl premium-card p-4 sm:p-5 shadow-sm mb-4">
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
                    className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <Undo2 className="w-3 h-3" /> Today
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{weekLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {ordered.length > 1 && (
              <div className="flex items-center gap-1.5">
                {ordered.map((e) => (
                  <button
                    key={e.subject}
                    type="button"
                    onClick={() => setActiveSubject(e.subject)}
                    className={`h-8 px-3 rounded-lg text-sm font-medium transition ${
                      e.subject === activeSubject
                        ? "btn-solid"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {subjectLabel(e.subject)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setWeekOffset((w) => w - 1)}
                className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
                aria-label="Previous week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setWeekOffset((w) => w + 1)}
                className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
                aria-label="Next week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {!week.loading && week.points.length === 0 && !week.roadmap ? (
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
            showRationale={isCurrent}
            showCoverage={showReview}
            onFocusAgain={focusAgain}
          />
        )}
      </div>

      <WithheldPlanPoints points={week.withheld} coverage={week.coverage} />

      {/* The week as a checklist, between the plan and the review: the panel above
          says what this week is and why, this one says what to press. */}
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

      {/* The student's own read on the week — its own box, not a footnote to the plan. */}
      {showReview && week.plan && active && (
        <div className="mb-6">
          <WeekReview
            studentId={studentId}
            plan={week.plan}
            points={week.points}
            coverage={week.coverage}
            activity={week.activity}
            subject={active.subject as SubjectV}
            board={active.board as BoardV}
            level={level}
            weekStart={weekStart}
            onChanged={week.reload}
          />
        </div>
      )}
    </>
  );
}

/**
 * Shown when the week has nothing and the programme has nothing to give it —
 * which means the student hasn't rated anything yet, so it points them at the
 * board. There is no button: the week is the course's to fill, not theirs.
 */
function EmptyState({ future }: { future: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
        <Sparkles className="w-5 h-5" />
      </div>
      <p className="text-sm font-medium mb-1">
        {future ? "Nothing planned for this week yet" : "No plan for this week yet"}
      </p>
      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
        {future
          ? "This week fills itself from your programme when it comes round."
          : "Sort a few topics on your planner and your week builds itself from them — weakest first, spread out to the exam."}
      </p>
    </div>
  );
}
