import { useStudentDirectory } from "@/hooks/data/useStudents";
import { LEVELS, SUBJECTS, type SubjectV } from "@/lib/curriculum/taxonomy";
import { type RosterWeekSummary } from "@/lib/planner/plannerRosterDal";
import {
  relativeWeekLabel,
  shortDayLabel,
  weekKeyToDate,
  weekRangeLabel,
} from "@/lib/planner/week";
import { type TutorPlannerState } from "./useTutorPlanner";
import { RosterGrid, type RosterCell, type RosterRow } from "./workbench/RosterGrid";

/** One subject's week for one student: its counts, or why there are none. */
function rosterCell(
  summary: RosterWeekSummary | undefined,
  editable: boolean,
  onBreak: boolean,
): RosterCell {
  if (summary) return { total: summary.total, done: summary.done, pinned: summary.pinned };
  return { note: onBreak ? "On a break" : editable ? "Not opened yet" : "No plan" };
}

/**
 * Every student, with how their week stands, as a grid across the page.
 *
 * It was a narrow list down the side with the page beside it empty until a
 * student was picked. Now the roster is the page: a row per student, a column
 * per subject, the week's counts in each cell, and when each student was last
 * on. The counts come from one read of the week's plan rows, as before.
 */
export function TutorRoster({ state }: { state: TutorPlannerState }) {
  const { students, visibleStudents, summaries, query, setQuery, filter, setFilter } = state;
  const { onBreak, editable, weekStart, currentWeek, shiftWeek, setWeek, openStudent } = state;
  const directory = useStudentDirectory();
  const seen = new Map(
    (directory.data ?? []).map((s) => [s.id, s.last_active_at ?? s.last_sign_in_at ?? null]),
  );
  // A column for each subject someone is on, in the app's own order.
  const subjects = SUBJECTS.map((s) => s.value).filter((subject) =>
    (students ?? []).some((s) => s.enrolments.some((e) => e.subject === subject)),
  );
  const rows = visibleStudents.map((s): RosterRow => {
    const mine = summaries?.get(s.id) ?? [];
    const away = onBreak(s.id);
    const last = seen.get(s.id);
    const cells: Partial<Record<SubjectV, RosterCell>> = {};
    for (const e of s.enrolments)
      cells[e.subject] = rosterCell(
        mine.find((w) => w.subject === e.subject),
        editable,
        away,
      );
    return {
      id: s.id,
      name: s.name ?? s.id.slice(0, 8),
      level: LEVELS.find((l) => l.value === s.level)?.label ?? null,
      lastOn: last ? shortDayLabel(new Date(last)) : null,
      cells,
    };
  });
  return (
    <RosterGrid
      rows={rows}
      total={students?.length ?? 0}
      subjects={subjects}
      week={{
        title: relativeWeekLabel(weekStart, currentWeek),
        dates: weekRangeLabel(weekKeyToDate(weekStart)),
        isCurrent: weekStart === currentWeek,
        onShift: shiftWeek,
        onToday: () => setWeek(currentWeek),
      }}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={setFilter}
      onOpen={openStudent}
    />
  );
}
