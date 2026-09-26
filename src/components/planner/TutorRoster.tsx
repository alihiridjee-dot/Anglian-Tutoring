import { Search, Users } from "lucide-react";
import { type PlannerStudent, type RosterWeekSummary } from "@/lib/planner/plannerRosterDal";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { type RosterFilter, type TutorPlannerState } from "./useTutorPlanner";
import { WeekSwitcher } from "./WeekSwitcher";

const FILTERS: { key: RosterFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unopened", label: "Not opened" },
  { key: "pinned", label: "Set by you" },
];

/** "6 set · 2 done · 1 by you", or why there is nothing to count. */
function summaryLine(s: RosterWeekSummary | undefined, editable: boolean): string {
  if (!s) return editable ? "not opened yet" : "no plan";
  if (s.total === 0) return "nothing set";
  const parts = [`${s.total} set`];
  if (s.done > 0) parts.push(`${s.done} done`);
  if (s.pinned > 0) parts.push(`${s.pinned} by you`);
  return parts.join(" · ");
}

/**
 * Every student, with how their week stands, in one scrollable list.
 *
 * A dropdown of names was fine for five students and useless for fifty: the
 * tutor could not see who had nothing set, who had not opened the week, or
 * whose plan they had already touched, without opening each one. The roster
 * answers those at a glance, from one read of the week's plan rows.
 */
export function TutorRoster({ state }: { state: TutorPlannerState }) {
  const { students, visibleStudents, summaries, query, setQuery, filter, setFilter } = state;
  const { studentId, selectStudent, editable, weekStart, currentWeek, shiftWeek, setWeek } = state;
  const total = students?.length ?? 0;
  return (
    <aside
      className="rounded-2xl premium-card shadow-sm flex flex-col min-h-0"
      aria-label="Students"
    >
      <div className="p-3 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          <span className="icon-tile size-8 shrink-0">
            <Users className="size-4" aria-hidden />
          </span>
          <h2 className="text-sm font-bold">
            Students <span className="text-muted-foreground font-medium">({total})</span>
          </h2>
        </div>
        {/* The week every count below is for — and, on a wide screen, the
            open student's week too. */}
        <WeekSwitcher
          weekStart={weekStart}
          currentWeek={currentWeek}
          onShift={shiftWeek}
          onToday={() => setWeek(currentWeek)}
          className="rounded-xl bg-muted/50 px-2.5 py-2"
        />
        <label className="flex items-center gap-2 h-11 sm:h-9 rounded-lg premium-card px-2.5">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a student"
            aria-label="Find a student"
            className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter students">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`h-11 sm:h-7 px-2.5 rounded-full text-[11px] font-semibold transition ${
                filter === f.key
                  ? "btn-solid"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="overflow-y-auto max-h-[70vh] lg:max-h-[calc(100vh-18rem)] divide-y divide-border">
        {visibleStudents.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground">
            {total === 0 ? "No students yet." : "No students match."}
          </li>
        )}
        {visibleStudents.map((s: PlannerStudent) => {
          const mine = summaries?.get(s.id) ?? [];
          const selected = s.id === studentId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => selectStudent(s.id)}
                aria-current={selected ? "true" : undefined}
                className={`w-full text-left px-3 py-2.5 transition ${
                  selected ? "bg-primary/10" : "hover:bg-muted/60"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-sm font-semibold truncate ${selected ? "text-primary" : ""}`}
                  >
                    {s.name ?? s.id.slice(0, 8)}
                  </span>
                  {s.level && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                      {s.level.replace("_", " ")}
                    </span>
                  )}
                </div>
                {s.enrolments.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-0.5">No enrolments</p>
                ) : (
                  <ul className="mt-0.5 space-y-0.5">
                    {s.enrolments.map((e) => {
                      const sum = mine.find((w) => w.subject === e.subject);
                      return (
                        <li key={e.subject} className="text-[11px] text-muted-foreground truncate">
                          <span className="font-medium text-foreground/80">
                            {subjectLabel(e.subject)}
                          </span>{" "}
                          · {summaryLine(sum, editable)}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
