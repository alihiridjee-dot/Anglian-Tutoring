import { toast } from "sonner";
import { EmptyState, Spinner } from "@/components/Shared";
import { TopicOrderEditor } from "../TopicOrderEditor";
import { type TutorPlannerState } from "../useTutorPlanner";
import { PlanAttention } from "./PlanAttention";
import { PlanSummary } from "./PlanSummary";
import { PlanWeekList } from "./PlanWeekList";
import { useFormattedSchedule } from "./useFormattedSchedule";

/**
 * The tutor's "Full plan" tab: how far through the course the student is, what
 * needs the tutor, then every week to the exams.
 *
 * It reads the roadmap the planner has already loaded for this student and
 * subject rather than fetching its own, so the tab opens on data that is
 * already there and a change made on "This week" shows up here without a
 * second request. Mount it under a key per student and subject, so a new
 * course opens folded, at this week.
 */
export function TutorFullPlan({ state }: { state: TutorPlannerState }) {
  const { student, roadmap, course, loading, reload, refreshAll } = state;
  const { orderEditorOpen, setOrderEditorOpen } = state;
  const view = useFormattedSchedule(roadmap);
  const { schedule } = view;
  if (!student) return null;
  const name = student.name ?? "This student";

  if (!roadmap || !schedule)
    return loading ? (
      <Spinner className="py-10" label="Loading the plan" />
    ) : (
      <EmptyState
        compact
        title="No curriculum for this course yet"
        body="Its spec points haven't been loaded, so there is nothing to plan."
      />
    );

  if (orderEditorOpen)
    return (
      <TopicOrderEditor
        data={roadmap}
        course={course}
        asTutor
        studentName={student.name}
        onCancel={() => setOrderEditorOpen(false)}
        onSaved={async () => {
          await reload();
          toast.success(`Topic order saved for ${name}.`);
          setOrderEditorOpen(false);
        }}
      />
    );

  return (
    <div className="space-y-6">
      <PlanSummary
        summary={schedule.summary}
        onReorder={schedule.replanPending ? null : () => setOrderEditorOpen(true)}
      />
      {schedule.hasAttention && (
        <PlanAttention
          attention={schedule.attention}
          studentName={name}
          course={course}
          onChanged={refreshAll}
        />
      )}
      <PlanWeekList
        months={view.months}
        hiddenWeeks={view.hiddenWeeks}
        earlierWeeks={schedule.earlierWeeks}
        showHistory={view.showHistory}
        onToggleHistory={view.toggleHistory}
        onShowRest={view.showRest}
      />
    </div>
  );
}
