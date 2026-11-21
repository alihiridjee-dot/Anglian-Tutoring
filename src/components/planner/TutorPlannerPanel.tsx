import { ErrorNote, Spinner } from "@/components/Shared";
import { TutorRoster } from "./TutorRoster";
import { useTutorPlanner } from "./useTutorPlanner";
import { TutorWorkbench } from "./workbench/TutorWorkbench";
import { WorkbenchBoundary } from "./workbench/WorkbenchBoundary";

/**
 * The tutor's planner: every student in a roster, and one student opened as a
 * workbench across the whole page.
 *
 * The roster says which student needs looking at. Opening one replaces it with
 * their workbench ({@link TutorWorkbench}): the plan as a grid, with what the
 * student needs and the topic order beside it, which leaves no room for the
 * roster alongside. "Students" on the workbench brings the roster back. Which
 * student, subject and week are open lives in the URL, so a student's plan can
 * be bookmarked or handed to a colleague.
 */
export function TutorPlannerPanel() {
  const state = useTutorPlanner();
  const { roster, students, student, studentId } = state;

  if (roster.error || state.week.error)
    return <ErrorNote error={roster.error ?? state.week.error} />;
  if (students === null) {
    return (
      <div className="rounded-2xl premium-card shadow-sm">
        <Spinner className="py-16" label="Loading students" />
      </div>
    );
  }

  if (student)
    return (
      // A new student or subject starts the workbench afresh: on the plan, this
      // month, nothing ticked.
      <WorkbenchBoundary key={`${student.id}:${state.activeSubject}`}>
        <TutorWorkbench state={state} />
      </WorkbenchBoundary>
    );

  // Nobody open: the roster is the page. An address naming a student who is
  // not on the roster says so above it.
  return (
    <div className="min-w-0 space-y-3">
      {studentId && <ErrorNote error={new Error("That student isn't on your roster.")} />}
      <TutorRoster state={state} />
    </div>
  );
}
