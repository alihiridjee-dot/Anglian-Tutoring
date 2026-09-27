import { ErrorNote, Spinner } from "@/components/Shared";
import { UserRound } from "lucide-react";
import { TutorRoster } from "./TutorRoster";
import { TutorStudentPane } from "./TutorStudentPane";
import { useTutorPlanner } from "./useTutorPlanner";

/**
 * The tutor's planner: every student down the side, one student's plan in
 * the middle.
 *
 * It used to be a dropdown of names above a single student's week, with the
 * year-long roadmap and the practice ledger stacked underneath — one long
 * page per student, and nothing that said which of forty students needed
 * looking at. Now the roster carries that answer, the open student's page is
 * tabbed like the student's own, and the URL names all of it so a week can
 * be bookmarked or handed to a colleague. The week control lives in the
 * roster, beside the counts it changes.
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

  return (
    // minmax(0, …) on both tracks: a grid track defaults to min-content, and a
    // long spec-point title would widen the pane past a phone screen.
    <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[19rem_minmax(0,1fr)] items-start">
      <div className={`min-w-0 ${studentId ? "hidden lg:block" : ""}`}>
        <TutorRoster state={state} />
      </div>
      <div className={`min-w-0 ${studentId ? "" : "hidden lg:block"}`}>
        {student ? (
          <TutorStudentPane state={state} />
        ) : (
          <div className="rounded-2xl premium-card p-6 sm:p-10 text-center shadow-sm">
            <span className="icon-tile size-10 mx-auto mb-3">
              <UserRound className="size-5" aria-hidden />
            </span>
            <p className="text-sm font-semibold">
              {studentId
                ? "That student isn't on your roster."
                : "Pick a student to open their week."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
