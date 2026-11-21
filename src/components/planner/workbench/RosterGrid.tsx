import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { EmptyState, SegmentedToggle } from "@/components/Shared";
import { SUBJECT_TINT, subjectLabel } from "@/lib/curriculum/subjectTheme";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import { cn } from "@/lib/utils";
import type { RosterFilter } from "../useTutorPlanner";
import { CTRL, Tally, TINT_TEXT } from "./figures";
import { Panel } from "./PlanGrid";

/** How one subject's week stands for one student. */
export type RosterCell =
  /** Not on this subject. */
  | null
  /** A week with a plan: what is set, done, and set by a tutor. */
  | { total: number; done: number; pinned: number }
  /** A week with no plan, and why: "Not opened yet", "On a break", "No plan". */
  | { note: string };

export interface RosterRow {
  id: string;
  name: string;
  /** "GCSE", "A LEVEL" */
  level: string | null;
  /** When they were last on, in words, or null when nothing says. */
  lastOn: string | null;
  cells: Partial<Record<SubjectV, RosterCell>>;
}

const FILTERS: { value: RosterFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unopened", label: "Not opened" },
  { value: "pinned", label: "Set by you" },
];

/** One subject's week: its counts in dots, or the reason there are none. */
function Cell({ cell }: { cell: RosterCell | undefined }) {
  if (!cell) return null;
  if ("note" in cell) return <span>{cell.note}</span>;
  if (cell.total === 0) return <span>Nothing set</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <Tally n={cell.total} word="set" />
      {cell.done > 0 && <Tally n={cell.done} word="done" tint="tint-emerald" />}
      {cell.pinned > 0 && <Tally n={cell.pinned} word="by you" tint="tint-accent" />}
    </span>
  );
}

/**
 * Every student and how their week stands, as one grid across the page: a row
 * per student, a column per subject. It answers who has nothing set, who has
 * not opened the week, and whose plan a tutor has already touched, without
 * opening anyone. A subject's cell opens that student on that subject; the
 * name opens them on their first. On a phone each student is a block.
 */
export function RosterGrid({
  rows,
  total,
  subjects,
  week,
  query,
  onQuery,
  filter,
  onFilter,
  onOpen,
}: {
  rows: RosterRow[];
  /** Every student, before the search and the filter. */
  total: number;
  /** The columns: the subjects any student is on, in the app's order. */
  subjects: SubjectV[];
  week: {
    /** "This week", "Next week", "2 weeks ago" */
    title: string;
    /** "16–22 Nov 2026" */
    dates: string;
    isCurrent: boolean;
    onShift: (weeks: number) => void;
    onToday: () => void;
  };
  query: string;
  onQuery: (query: string) => void;
  filter: RosterFilter;
  onFilter: (filter: RosterFilter) => void;
  onOpen: (studentId: string, subject?: SubjectV) => void;
}) {
  const round =
    "btn-soft grid size-11 shrink-0 place-items-center rounded-lg sm:pointer-fine:size-8";
  return (
    <Panel
      id="workbench-roster"
      title="Students"
      aside={<Tally n={total} word={total === 1 ? "student" : "students"} />}
    >
      {/* The week every count is for, then who to show. */}
      <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 text-sm">
        <div role="group" aria-label="Week" className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous week"
            className={round}
            onClick={() => week.onShift(-1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <b aria-live="polite" className="whitespace-nowrap">
            {week.title} · {week.dates}
          </b>
          <button
            type="button"
            aria-label="Next week"
            className={round}
            onClick={() => week.onShift(1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
          {!week.isCurrent && (
            <button type="button" className={CTRL} onClick={week.onToday}>
              This week
            </button>
          )}
        </div>
        <label className="premium-input flex min-h-11 min-w-48 flex-1 items-center gap-2 rounded-lg! px-2.5 sm:pointer-fine:min-h-8 lg:max-w-xs">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Find a student"
            aria-label="Find a student"
            className="min-w-0 flex-1 bg-transparent focus:outline-none"
          />
        </label>
        <SegmentedToggle
          layoutId="workbench-roster-filter"
          label="Show"
          value={filter}
          onChange={(value) => onFilter(value as RosterFilter)}
          items={FILTERS}
        />
      </div>

      {rows.length === 0 ? (
        <div className="p-3">
          <EmptyState compact title={total === 0 ? "No students yet" : "No students match"} />
        </div>
      ) : (
        <>
          {/* A laptop: the grid. */}
          <div className="relative hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="[&_th]:px-3 [&_th]:py-1.5 [&_th]:font-extrabold [&_th]:whitespace-nowrap">
                  <th>Student</th>
                  <th>Course</th>
                  {subjects.map((subject) => (
                    <th key={subject} className={cn(SUBJECT_TINT[subject], TINT_TEXT)}>
                      {subjectLabel(subject)}
                    </th>
                  ))}
                  <th>Last on</th>
                </tr>
              </thead>
              <tbody className="[&_td]:px-3 [&_td]:py-1">
                {rows.map((row) => (
                  <tr key={row.id} className="border-border border-t align-middle">
                    <td>
                      <button
                        type="button"
                        onClick={() => onOpen(row.id)}
                        className="btn-ghost -ml-2 min-h-9 rounded-lg px-2 text-left font-bold text-[color:var(--foreground)]!"
                      >
                        {row.name}
                      </button>
                    </td>
                    <td className="whitespace-nowrap">{row.level}</td>
                    {subjects.map((subject) => {
                      const cell = row.cells[subject];
                      return (
                        <td key={subject} className={SUBJECT_TINT[subject]}>
                          {cell && (
                            <button
                              type="button"
                              onClick={() => onOpen(row.id, subject)}
                              aria-label={`Open ${row.name}'s ${subjectLabel(subject)}`}
                              className="btn-ghost -ml-2 min-h-9 rounded-lg px-2 text-left font-normal text-[color:var(--foreground)]!"
                            >
                              <Cell cell={cell} />
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap">{row.lastOn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* A phone: each student a block, each subject a line to tap. */}
          <ul className="divide-border divide-y text-sm lg:hidden">
            {rows.map((row) => (
              <li key={row.id} className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                >
                  <b className="text-base">{row.name}</b>
                  <span className="whitespace-nowrap">{row.level}</span>
                </button>
                <ul>
                  {subjects.map((subject) => {
                    const cell = row.cells[subject];
                    return cell ? (
                      <li key={subject} className={SUBJECT_TINT[subject]}>
                        <button
                          type="button"
                          onClick={() => onOpen(row.id, subject)}
                          className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
                        >
                          <b className={cn("w-24 shrink-0", TINT_TEXT)}>{subjectLabel(subject)}</b>
                          <Cell cell={cell} />
                        </button>
                      </li>
                    ) : null;
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
