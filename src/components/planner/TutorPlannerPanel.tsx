import { WithheldPlanPoints } from "./WithheldPlanPoints";
import { ErrorNote } from "@/components/Shared";
import { Spinner } from "@/components/Shared";
import { Loader2, CalendarRange, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { type SubjectV, type BoardV } from "@/lib/curriculum/taxonomy";
import { RoadmapPanel } from "./RoadmapPanel";
import { CoveredLedger } from "./CoveredLedger";
import { WeekReview } from "./WeekReview";
import { TopicOrderEditor } from "./TopicOrderEditor";
import { useTutorPlanner } from "./useTutorPlanner";
import {
  AddPointsBox,
  OverridesPanel,
  OverridesUnavailable,
  PlannerToolbar,
  SchedulingAttention,
  SubjectTabs,
  WeekPointGroup,
} from "./TutorPlannerParts";

/**
 * The tutor's window into any student's weekly plan. Pick a student, page
 * through their weeks, and take charge of the plan: see what is saved and what
 * the programme will add, pin spec points in, take them out of a week or out
 * of the programme, move them between weeks, and reorder the topics to come.
 * Writes bind to the chosen student (tutor RLS on the plan tables allows it),
 * and every removal is recorded so the scheduler cannot undo it
 * ([[overrides]]).
 */
export function TutorPlannerPanel() {
  const planner = useTutorPlanner();
  const {
    roster,
    students,
    student,
    ordered,
    active,
    course,
    weekOffset,
    weekStart,
    weekLabel,
    isCurrent,
    showReview,
    editable,
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
    projection,
    overridesAvailable,
    orderEditorOpen,
    setOrderEditorOpen,
  } = planner;

  if (roster.error || week.error) return <ErrorNote error={roster.error ?? week.error} />;
  if (students === null) {
    return (
      <div className="rounded-2xl premium-card p-16 text-center shadow-sm">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const projectedCount = groups.reduce(
    (n, g) => n + g.rows.filter((r) => r.state === "projected").length,
    0,
  );

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
                {editable ? "Editing" : "Viewing"} the plan for{" "}
                <span className="font-semibold text-foreground">{weekLabel}</span>
                {isCurrent ? " (this week)" : weekOffset < 0 ? " (past week)" : " (upcoming week)"}
                {editable
                  ? projection && projectedCount > 0
                    ? ` · ${projectedCount} ${projectedCount === 1 ? "point is" : "points are"} planned but not saved yet · changes apply to this week only.`
                    : " · changes apply to this week only."
                  : " · past weeks are history."}
              </p>
            </div>
            {overridesAvailable === false && editable && <OverridesUnavailable />}
            {groups.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {editable
                  ? `Nothing is set or planned for ${weekLabel} — add spec points below to build the week.`
                  : `No plan was set for ${weekLabel}.`}
              </p>
            ) : (
              groups.map((g) => <WeekPointGroup key={g.topicId} g={g} {...planner} />)
            )}

            <OverridesPanel {...planner} subject={active.subject} />

            <WithheldPlanPoints points={week.withheld} coverage={week.coverage} />

            {/* Add spec points */}
            {editable && <AddPointsBox {...planner} student={student} active={active} />}

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
          {orderEditorOpen && roadmap ? (
            <div className="rounded-2xl premium-card p-4 sm:p-5 shadow-sm mt-6">
              <TopicOrderEditor
                key={`${student.id}:${course.subject}`}
                data={roadmap}
                course={course}
                asTutor
                studentName={student.name}
                onCancel={() => setOrderEditorOpen(false)}
                onSaved={async () => {
                  await reload();
                  bumpRefresh();
                  toast.success(`Topic order saved for ${student.name ?? "the student"}.`);
                  setOrderEditorOpen(false);
                }}
              />
            </div>
          ) : (
            <>
              {roadmap && !roadmap.needsAck && (
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOrderEditorOpen(true)}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted"
                  >
                    <SlidersHorizontal className="w-4 h-4" aria-hidden /> Change topic order
                  </button>
                </div>
              )}
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
      )}
    </>
  );
}
