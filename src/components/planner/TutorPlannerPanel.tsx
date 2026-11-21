import { ErrorNote, Spinner } from "@/components/Shared";
import { UserRound } from "lucide-react";
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

  return (
    // minmax(0, …) on both tracks: a grid track defaults to min-content, and a
    // long name would widen the page past a phone screen.
    <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[19rem_minmax(0,1fr)] items-start">
      <div className="min-w-0">
        <TutorRoster state={state} />
      </div>
      <div className="hidden min-w-0 lg:block">
        <div className="rounded-2xl premium-card p-6 sm:p-10 text-center shadow-sm">
          <span className="icon-tile size-10 mx-auto mb-3">
            <UserRound className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-semibold">
            {studentId
              ? "That student isn't on your roster."
              : "Pick a student to open their plan."}
          </p>
        </div>
      </div>
    </div>
  );
}
