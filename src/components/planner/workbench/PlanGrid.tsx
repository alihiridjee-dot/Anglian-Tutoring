import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, GripVertical, Plus } from "lucide-react";
import { SegmentedToggle } from "@/components/Shared";
import type { BoardV, LevelV, SubjectV } from "@/lib/curriculum/taxonomy";
import { cn } from "@/lib/utils";
import { CTRL, FIELD, StatusWord, Tally, TINT_TEXT, WorkCell } from "./figures";
import {
  LANE_ORDER,
  LANES,
  moveTargets,
  rowShown,
  type GridMonth,
  type GridRow,
  type GridWeek,
  type LaneKey,
  type Show,
} from "./gridData";

const SHOWS: { value: Show; label: string }[] = [
  { value: "all", label: "Everything" },
  ...LANE_ORDER.map((lane) => ({ value: lane as Show, label: LANES[lane].label })),
  { value: "weak", label: "Shaky" },
  { value: "not_done", label: "Not done" },
  { value: "missed", label: "Missed" },
];

/** One part of the workbench: a plain panel under its name. */
export function Panel({
  id,
  title,
  aside,
  children,
}: {
  id?: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="premium-card min-w-0 scroll-mt-3">
      <header className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-base font-extrabold">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** The course the plan is for: a line's spec point opens on its page in this course. */
export interface GridCourse {
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
}

/**
 * A line's spec point, as a link to its page: the curriculum's own, the one a
 * student and the search reach it by. Its `::after` covers the whole line, so
 * the line is the link, marks included; the tick box and the handle sit above
 * it. It isn't dragged itself, so dragging the line still moves it.
 */
function PointLink({
  row,
  course,
  className,
  children,
}: {
  row: GridRow;
  course: GridCourse;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to="/curriculum"
      search={{ ...course, point: row.specPointId }}
      draggable={false}
      className={cn(
        "after:absolute after:inset-0 after:z-[1] after:content-[''] group-hover:underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** A lane's name on its own band, in the lane's colour, over the lines filed under it. */
function LaneBand({ lane }: { lane: LaneKey }) {
  return (
    <span
      className={cn(
        "block border-l-4 border-[var(--tint)] bg-[color-mix(in_oklab,var(--tint)_9%,var(--card))] px-2 py-1 text-left font-extrabold",
        TINT_TEXT,
      )}
    >
      {LANES[lane].label}
    </span>
  );
}

/**
 * The course a month at a time: its weeks down the page, and under each week
 * its lines, filed by why they are there. There is one way to change it: tick
 * lines (or a whole week), then act on them in the bar that appears. Dragging a
 * line onto another week moves it. Weeks gone by, and breaks, are read only.
 * Clicking a line opens its spec point's page; Back comes back to the line.
 */
export function PlanGrid({
  months,
  month: chosenMonth,
  onMonth,
  show,
  onShow,
  busy,
  onMove,
  onRemove,
  onSkip,
  onAdd,
  addingWeek,
  addSlot,
  footer,
  course,
}: {
  months: GridMonth[];
  /** The month on screen; null for the one holding this week. */
  month: string | null;
  onMonth: (key: string) => void;
  show: Show;
  onShow: (show: Show) => void;
  /** A change is being saved: the controls wait. */
  busy: boolean;
  onMove: (rows: GridRow[], week: string) => void;
  onRemove: (rows: GridRow[]) => void;
  onSkip: (rows: GridRow[]) => void;
  /** Open the point picker for a week. Left out when points can't be added. */
  onAdd?: (week: GridWeek) => void;
  /** The week whose picker is open, and the picker, drawn under that week's name. */
  addingWeek?: string | null;
  addSlot?: ReactNode;
  /** What else belongs to the plan: what the tutor has removed or skipped. */
  footer?: ReactNode;
  /** The course, so each line opens its spec point. Left out, the lines are not links. */
  course?: GridCourse | null;
}) {
  const thisMonth =
    months.find((m) => m.weeks.some((w) => w.tag === "This week"))?.key ?? months[0]?.key ?? "";
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const month = months.some((m) => m.key === chosenMonth) ? chosenMonth! : thisMonth;
  const weeks = months.find((m) => m.key === month)?.weeks ?? [];
  const targets = useMemo(() => moveTargets(months), [months]);
  // Only lines that are still on the page and may be changed stay ticked.
  const chosen = useMemo(
    () =>
      months
        .flatMap((m) => m.weeks)
        .filter((w) => !w.locked)
        .flatMap((w) => w.rows)
        .filter((row) => picked.has(row.id)),
    [months, picked],
  );
  const tick = (ids: string[], on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      for (const id of ids)
        if (on) next.add(id);
        else next.delete(id);
      return next;
    });
  const act = (run: () => void) => {
    run();
    setPicked(new Set());
  };

  return (
    <Panel
      id="workbench-plan"
      title="Plan"
      aside={
        <select
          aria-label="Show"
          className={FIELD}
          value={show}
          onChange={(e) => onShow(e.target.value as Show)}
        >
          {SHOWS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      }
    >
      {months.length > 1 && (
        <div className="border-border border-b px-3 py-2">
          <SegmentedToggle
            layoutId="workbench-month"
            label="Month"
            value={month}
            onChange={onMonth}
            items={months.map((m) => ({ value: m.key, label: m.label }))}
          />
        </div>
      )}

      {weeks.map((week, at) => {
        const mine = week.rows.filter((row) => rowShown(row, show));
        // A week the filter leaves empty is not drawn.
        if (show !== "all" && mine.length === 0) return null;
        const ids = mine.map((row) => row.id);
        const all = ids.length > 0 && ids.every((id) => picked.has(id));
        const done = mine.filter((row) => row.ticked).length;
        const shaky = mine.filter((row) => row.status === "weak" && !row.missed).length;
        const missed = mine.filter((row) => row.missed).length;
        const lanes = LANE_ORDER.filter((lane) => mine.some((row) => row.lane === lane));
        const droppable = !week.locked && !!dragging;
        return (
          <section
            key={week.key}
            aria-label={`Week of ${week.dates}`}
            onDragOver={(e) => {
              if (!droppable) return;
              e.preventDefault();
              setOver(week.key);
            }}
            onDrop={() => {
              if (week.locked || !dragging) return;
              // A ticked line takes the other ticked lines with it; an unticked one goes alone.
              const moving = picked.has(dragging)
                ? chosen
                : months
                    .flatMap((m) => m.weeks)
                    .flatMap((w) => w.rows)
                    .filter((row) => row.id === dragging);
              setDragging(null);
              setOver(null);
              act(() => onMove(moving, week.key));
            }}
            className={cn(
              // Each week is its own block, with clear air above it.
              at > 0 && "mt-5",
              over === week.key && "bg-[color-mix(in_oklab,var(--tint)_10%,transparent)]",
            )}
          >
            {/* The week's name stays in view while its lines scroll under it. This
                week is a solid bar, a week gone by is grey, a week to come is pale. */}
            <header
              className={cn(
                "sticky top-0 z-[1] flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm",
                week.tag === "This week"
                  ? "bg-[var(--tint)] text-white"
                  : week.tag === "Past"
                    ? "tint-slate bg-[color-mix(in_oklab,var(--tint)_16%,var(--card))]"
                    : "bg-[color-mix(in_oklab,var(--tint)_12%,var(--card))]",
              )}
            >
              {!week.locked && mine.length > 0 && (
                <input
                  type="checkbox"
                  aria-label={`Tick every line in ${week.dates}`}
                  checked={all}
                  onChange={(e) => tick(ids, e.target.checked)}
                />
              )}
              <h3 className="text-lg leading-tight font-extrabold">
                {week.tag} · {week.dates}
              </h3>
              {week.note ? (
                <b>{week.note}</b>
              ) : (
                <>
                  <Tally n={mine.length} word={mine.length === 1 ? "point" : "points"} />
                  {done > 0 && <Tally n={done} word="ticked" tint="tint-emerald" />}
                  {shaky > 0 && <Tally n={shaky} word="shaky" tint="tint-amber" />}
                  {missed > 0 && <Tally n={missed} word="missed" tint="tint-rose" />}
                  {week.unopened && <span>Not opened yet</span>}
                </>
              )}
              {!week.locked && onAdd && (
                <button
                  type="button"
                  className={cn(CTRL, "ml-auto")}
                  disabled={busy}
                  onClick={() => onAdd(week)}
                >
                  <Plus className="size-4" aria-hidden /> Add
                </button>
              )}
            </header>

            {addingWeek === week.key && addSlot && (
              <div className="border-border border-b p-3">{addSlot}</div>
            )}

            {/* A laptop: the full grid. */}
            {mine.length > 0 && (
              <div className="relative hidden overflow-x-auto lg:block">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    <col className="w-12" />
                    <col className="w-32" />
                    <col />
                    <col className="w-52 max-2xl:hidden" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col className="w-36" />
                    <col className="w-32 max-2xl:hidden" />
                    <col className="w-32" />
                  </colgroup>
                  {/* The column names are drawn once, over the month's first week. */}
                  <thead className={at === 0 ? undefined : "sr-only"}>
                    <tr className="[&_th]:px-2 [&_th]:py-1 [&_th]:font-extrabold [&_th]:whitespace-nowrap">
                      <th>
                        <span className="sr-only">Tick</span>
                      </th>
                      <th>Code</th>
                      <th>Spec point</th>
                      <th className="max-2xl:hidden">Topic</th>
                      <th>Task</th>
                      <th>Quiz</th>
                      <th>How it's going</th>
                      <th className="max-2xl:hidden">Ticked</th>
                      <th>Last practised</th>
                    </tr>
                  </thead>
                  {lanes.map((lane) => (
                    <tbody key={lane} className={cn(LANES[lane].tint, "[&_td]:px-2 [&_td]:py-1.5")}>
                      <tr>
                        <th colSpan={7} scope="rowgroup" className="p-0">
                          <LaneBand lane={lane} />
                        </th>
                        {/* The band runs on under the two columns a wide screen adds. */}
                        <td
                          colSpan={2}
                          aria-hidden
                          className="bg-[color-mix(in_oklab,var(--tint)_9%,var(--card))] p-0! max-2xl:hidden"
                        />
                      </tr>
                      {mine
                        .filter((row) => row.lane === lane)
                        .map((row) => (
                          <tr
                            key={row.id}
                            draggable={!week.locked && !busy}
                            onDragStart={() => setDragging(row.id)}
                            onDragEnd={() => {
                              setDragging(null);
                              setOver(null);
                            }}
                            className={cn(
                              "border-border border-t align-middle",
                              course &&
                                "group relative hover:bg-[color-mix(in_oklab,var(--tint)_6%,transparent)]",
                              picked.has(row.id) &&
                                "bg-[color-mix(in_oklab,var(--tint)_12%,transparent)]",
                            )}
                          >
                            <td className="border-l-4 border-l-[var(--tint)]">
                              {!week.locked && (
                                <span className="relative z-[2] flex items-center gap-1">
                                  <GripVertical className="size-4 cursor-grab" aria-hidden />
                                  <input
                                    type="checkbox"
                                    aria-label={`Tick ${row.code} ${row.title}`}
                                    checked={picked.has(row.id)}
                                    onChange={(e) => tick([row.id], e.target.checked)}
                                  />
                                </span>
                              )}
                            </td>
                            <td className="font-bold break-words">{row.code}</td>
                            <td className="font-bold">
                              {course ? (
                                <PointLink row={row} course={course}>
                                  {row.title}
                                </PointLink>
                              ) : (
                                row.title
                              )}
                            </td>
                            <td className="max-2xl:hidden">{row.topic}</td>
                            <td className="whitespace-nowrap">
                              <WorkCell work={row.task} />
                            </td>
                            <td className="whitespace-nowrap">
                              <WorkCell work={row.quiz} />
                            </td>
                            <td>
                              <StatusWord status={row.status} missed={row.missed} />
                            </td>
                            <td className="whitespace-nowrap max-2xl:hidden">
                              {row.ticked && (
                                <span className="tint-emerald inline-flex items-center gap-1">
                                  <Check
                                    className="size-4 text-[color:var(--tint)]"
                                    strokeWidth={3.5}
                                    aria-hidden
                                  />
                                  {row.ticked}
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap">{row.last ?? "Never"}</td>
                          </tr>
                        ))}
                    </tbody>
                  ))}
                </table>
              </div>
            )}

            {/* A phone: the point and how it is going, nothing else. */}
            <div className="lg:hidden">
              {lanes.map((lane) => (
                <div key={lane} className={LANES[lane].tint}>
                  <LaneBand lane={lane} />
                  <ul>
                    {mine
                      .filter((row) => row.lane === lane)
                      .map((row) => (
                        <li
                          key={row.id}
                          className={cn(
                            "border-border border-t border-l-4 border-l-[var(--tint)]",
                            course && "group relative",
                          )}
                        >
                          {/* The line opens its point; the tick box keeps a
                              finger-sized spot of its own above the link. */}
                          <div className="flex min-h-11 items-center pr-3">
                            {week.locked ? (
                              <span className="w-3 shrink-0" />
                            ) : (
                              <label className="relative z-[2] flex min-h-11 w-11 shrink-0 items-center justify-center">
                                <input
                                  type="checkbox"
                                  aria-label={`Tick ${row.code} ${row.title}`}
                                  className="size-5"
                                  checked={picked.has(row.id)}
                                  onChange={(e) => tick([row.id], e.target.checked)}
                                />
                              </label>
                            )}
                            <span className="min-w-0 flex-1 py-2">
                              {course ? (
                                <PointLink
                                  row={row}
                                  course={course}
                                  className="block leading-snug font-bold"
                                >
                                  {row.code} {row.title}
                                </PointLink>
                              ) : (
                                <b className="block leading-snug">
                                  {row.code} {row.title}
                                </b>
                              )}
                              <StatusWord status={row.status} missed={row.missed} />
                            </span>
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* What can be done to the ticked lines: only there when something is ticked. */}
      {chosen.length > 0 && (
        <div className="premium-card sticky bottom-2 z-10 m-2 flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <Tally n={chosen.length} word="ticked" />
          <select
            aria-label="Move the ticked lines to a week"
            className={FIELD}
            value=""
            disabled={busy}
            onChange={(e) => {
              const to = e.target.value;
              if (to) act(() => onMove(chosen, to));
            }}
          >
            <option value="">Move to…</option>
            {targets.map((w) => (
              <option key={w.key} value={w.key}>
                {w.dates}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={CTRL}
            disabled={busy}
            onClick={() => act(() => onRemove(chosen))}
          >
            Remove
          </button>
          <button
            type="button"
            className={CTRL}
            disabled={busy}
            onClick={() => act(() => onSkip(chosen))}
          >
            Skip for good
          </button>
          <button
            type="button"
            className={cn(CTRL, "ml-auto")}
            onClick={() => setPicked(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {footer && <div className="border-border mt-5 border-t p-3">{footer}</div>}
    </Panel>
  );
}
