import { WithheldPlanPoints } from "./WithheldPlanPoints";
import { ErrorNote } from "@/components/Shared";
import { Spinner } from "@/components/Shared";
import { Loader2, CalendarRange } from "lucide-react";
import { type SubjectV, type BoardV } from "@/lib/curriculum/taxonomy";
import { RoadmapPanel } from "./RoadmapPanel";
import { CoveredLedger } from "./CoveredLedger";
import { WeekReview } from "./WeekReview";
import { useTutorPlanner } from "./useTutorPlanner";
import {
  AddPointsBox,
  PlannerToolbar,
  SchedulingAttention,
  SubjectTabs,
  WeekPointGroup,
} from "./TutorPlannerParts";

/**
 * The tutor's window into any student's weekly plan. Pick a student, page
 * through their weeks, and adjust the plan — add spec points from the curriculum
 * picker, remove them, and see the coverage/check-in for past weeks. Writes bind
 * to the chosen student (tutor RLS on the plan tables allows it).
 */
export function TutorPlannerPanel() {
  const planner = useTutorPlanner();
  const {
    roster,
    students,
    student,
    ordered,
    active,
    weekOffset,
    weekStart,
    weekLabel,
    isCurrent,
    showReview,
    refreshToken,
    bumpRefresh,
    week,
    plan,
    points,
    coverage,
    activity,
    roadmap,
    loading,
    reload,
    groups,
  } = planner;

  if (roster.error || week.error) return <ErrorNote error={roster.error ?? week.error} />;
  if (students === null) {
    return (
      <div className="rounded-2xl premium-card p-16 text-center shadow-sm">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {roadmap?.focusLoad.overloaded && <SchedulingAttention roadmap={roadmap} />}
      <div className="rounded-2xl premium-card p-4 sm:p-5 shadow-sm">
        {/* Student picker + week nav */}
        <PlannerToolbar {...planner} students={students} />

        {/* Subject tabs */}
        {ordered.length > 0 && <SubjectTabs {...planner} />}

        {!student || !active ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {student && student.enrolments.length === 0
              ? "This student has no subject enrolments yet."
              : "Pick a student to view and adjust their weekly plan."}
          </p>
        ) : loading ? (
          <Spinner className="py-10" />
        ) : (
          <div className="space-y-4">
            {/* Editing boundary — make it unmistakable which week these points belong to */}
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <CalendarRange className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <p className="text-[11px] text-muted-foreground">
                Editing the plan for{" "}
                <span className="font-semibold text-foreground">{weekLabel}</span>
                {isCurrent
                  ? " (this week)"
                  : weekOffset < 0
                    ? " (past week)"
                    : " (upcoming week)"}{" "}
                · changes apply to this week only.
              </p>
            </div>
            {points.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No plan for {weekLabel} yet — add spec points below to build one.
              </p>
            ) : (
              groups.map((g) => (
                <WeekPointGroup
                  key={g.title}
                  g={g}
                  coverage={coverage}
                  activity={activity}
                  showReview={showReview}
                />
              ))
            )}

            <WithheldPlanPoints points={week.withheld} coverage={week.coverage} />

            {/* Add spec points */}
            <AddPointsBox {...planner} student={student} active={active} />

            {showReview && plan && (
              <WeekReview
                studentId={student.id}
                plan={plan}
                points={points}
                coverage={coverage}
                activity={activity}
                subject={active.subject as SubjectV}
                board={active.board as BoardV}
                level={student.level ?? "gcse"}
                weekStart={weekStart}
                onChanged={() => {
                  reload();
                  bumpRefresh();
                }}
                readOnly
              />
            )}
          </div>
        )}
      </div>
      {student && student.level && (
        <>
          <RoadmapPanel
            studentId={student.id}
            enrolments={student.enrolments}
            level={student.level}
            asTutor
            studentName={student.name}
            refreshToken={refreshToken}
          />
          <CoveredLedger
            studentId={student.id}
            enrolments={student.enrolments}
            level={student.level}
          />
        </>
      )}
    </>
  );
}
