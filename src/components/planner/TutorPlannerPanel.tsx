import { ErrorNote } from "@/components/Shared";
import { CalendarRange, ChevronLeft, ChevronRight, Loader2, Undo2, UserRound } from "lucide-react";
import { TutorRoster } from "./TutorRoster";
import { TutorStudentPane } from "./TutorStudentPane";
import { useTutorPlanner } from "./useTutorPlanner";

/**
 * The tutor's planner: every student down the side, one student's week in
 * the middle, one week control over both.
 *
 * It used to be a dropdown of names above a single student's week, with the
 * year-long roadmap and the practice ledger stacked underneath — one long
 * page per student, and nothing that said which of forty students needed
 * looking at. Now the roster carries that answer, the open student's page is
 * tabbed like the student's own, and the URL names all of it so a week can
 * be bookmarked or handed to a colleague.
 */
export function TutorPlannerPanel() {
  const state = useTutorPlanner();
  const { roster, students, student, studentId, isCurrent, weekLabel, shiftWeek, setWeek } = state;
  const { currentWeek, editable } = state;

  if (roster.error || state.week.error)
    return <ErrorNote error={roster.error ?? state.week.error} />;
  if (students === null) {
    return (
      <div className="rounded-2xl premium-card p-16 text-center shadow-sm">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* One week for the whole screen: the roster's counts and the open student's plan. */}
      <div className="rounded-2xl premium-card shadow-sm px-3 py-2 sm:px-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-semibold">
            {isCurrent ? "This week" : editable ? "Upcoming week" : "Past week"}
          </span>
          <span className="text-sm text-muted-foreground">{weekLabel}</span>
          {!isCurrent && (
            <button
              type="button"
              onClick={() => setWeek(currentWeek)}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <Undo2 className="w-3 h-3" aria-hidden /> Today
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* minmax(0, …) on both tracks: a grid track defaults to min-content, and a
          long spec-point title would widen the pane past a phone screen. */}
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[19rem_minmax(0,1fr)] items-start">
        <div className={`min-w-0 ${studentId ? "hidden lg:block" : ""}`}>
          <TutorRoster state={state} />
        </div>
        <div className={`min-w-0 ${studentId ? "" : "hidden lg:block"}`}>
          {student ? (
            <TutorStudentPane state={state} />
          ) : (
            <div className="rounded-2xl premium-card p-10 text-center shadow-sm">
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
    </div>
  );
}
