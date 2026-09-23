import { useId, useState } from "react";
import { BookOpen, CheckCircle2, ChevronDown, History, RefreshCw, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarePointRow, PointRow } from "../PointRow";
import { LANE_META } from "../tutorWeekRows";
import { type PlanLine as Line, type PlanLineKind, type PlanPoint } from "./formatSchedule";

/**
 * The three reasons work sits on a week, each with its own word, icon and
 * colour — the same colours the student's own plan uses for new learning,
 * missed work and revision, so tutor and student read one plan.
 *
 * The icon carries the distinction as well as the colour, so the plan still
 * reads for someone who cannot tell amber from rose.
 */
const KIND: Record<
  PlanLineKind,
  { label: string; icon: typeof BookOpen; tint: string; about: string }
> = {
  teach: {
    label: "Teaching",
    icon: BookOpen,
    tint: "tint-primary",
    about: LANE_META.course.hint,
  },
  catchup: {
    label: "Catching up",
    icon: History,
    tint: "tint-amber",
    about: LANE_META.catchup.hint,
  },
  revisit: {
    label: "Revisiting",
    icon: Repeat,
    tint: "tint-rose",
    about: LANE_META.revision.hint,
  },
};

/**
 * One line of a week: why it is there, the topic, anything worth flagging,
 * and how many spec points — opening to the points themselves.
 *
 * On a phone the pane is barely 250px wide, so the reason and the chevron
 * take the first row and the topic, its flags and its count wrap freely
 * below. From `sm` up the three sit in one row, and the reason column is
 * fixed so every topic in the list starts at the same x.
 */
export function PlanLine({ line, isNow }: { line: Line; isNow: boolean }) {
  const [open, setOpen] = useState(false);
  const [whole, setWhole] = useState(false);
  const panelId = useId();
  const kind = KIND[line.kind];
  const Icon = kind.icon;
  const count = line.points.length;
  const expandable = count > 0 || line.wholeTopic !== null;
  const countLabel = `${count} ${count === 1 ? "point" : "points"}`;

  const grid =
    "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-1.5 py-1.5 text-left sm:grid-cols-[8.5rem_minmax(0,1fr)_auto] sm:px-2";
  const summary = (
    <>
      <span className="chip w-fit text-[11px]" title={kind.about}>
        <Icon className="size-3" aria-hidden />
        {kind.label}
      </span>
      <span className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <span className="text-sm font-semibold leading-snug">{line.title}</span>
        <LineFlags line={line} isNow={isNow} />
        {count > 0 && (
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:hidden">
            {countLabel}
          </span>
        )}
        {line.kind === "teach" && line.replaces && (
          <span className="basis-full text-xs text-muted-foreground">Replaces {line.replaces}</span>
        )}
      </span>
      <span className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 sm:col-start-3">
        {count > 0 && (
          <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:inline">
            {countLabel}
          </span>
        )}
        {expandable && (
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        )}
      </span>
    </>
  );

  return (
    <li className={kind.tint}>
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className={cn(
            grid,
            "transition-colors hover:bg-[color:color-mix(in_oklab,var(--tint)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tint)]",
          )}
        >
          {summary}
        </button>
      ) : (
        <div className={grid}>{summary}</div>
      )}
      {open && (
        <LinePoints
          id={panelId}
          line={line}
          whole={whole}
          onToggleWhole={() => setWhole((v) => !v)}
        />
      )}
    </li>
  );
}

/** What is worth a glance on the line itself: a re-plan, missed work, or a finished topic. */
function LineFlags({ line, isNow }: { line: Line; isNow: boolean }) {
  if (line.kind === "teach")
    return (
      <>
        {line.change && (
          <span className="chip tint-amber text-[11px]" title={line.change.detail}>
            <RefreshCw className="size-3" aria-hidden />
            {line.change.label}
          </span>
        )}
        {line.missed > 0 && (
          <span className="chip tint-amber text-[11px]">{line.missed} missed</span>
        )}
        {line.covered && (
          <span className="chip tint-emerald text-[11px]">
            <CheckCircle2 className="size-3" aria-hidden />
            Covered
          </span>
        )}
      </>
    );
  // Only this week's catch-up can already be saved; every later week is a
  // projection by nature, so saying "estimated" on each of them says nothing.
  if (line.kind === "catchup" && isNow)
    return <span className="chip text-[11px]">{line.confirmed ? "Assigned" : "Expected"}</span>;
  return null;
}

/** The line opened: its spec points, and the rest of the topic when this week holds only part. */
function LinePoints({
  id,
  line,
  whole,
  onToggleWhole,
}: {
  id: string;
  line: Line;
  whole: boolean;
  onToggleWhole: () => void;
}) {
  // A week with none of the topic's points (a hand-fixed split) has only the
  // whole topic to show, so it opens straight onto it with no toggle.
  const onlyWhole = line.points.length === 0;
  const shown = (whole || onlyWhole) && line.wholeTopic ? line.wholeTopic : line.points;
  return (
    <div
      id={id}
      className="mx-1 mb-2 mt-0.5 space-y-2 rounded-lg border border-[color:color-mix(in_oklab,var(--tint)_22%,var(--border))] bg-[color:color-mix(in_oklab,var(--tint)_4%,var(--card))] px-2.5 py-2 sm:mr-2 sm:ml-[9.75rem] sm:px-3"
    >
      {line.kind === "catchup" ? (
        line.byDueWeek.map((group) => (
          <div key={group.week}>
            <p className="text-xs font-semibold text-muted-foreground">
              From the week of {group.label}
            </p>
            <PointList points={group.points} />
          </div>
        ))
      ) : (
        <PointList points={shown} />
      )}
      {line.wholeTopic && !onlyWhole && (
        <button
          type="button"
          onClick={onToggleWhole}
          className="text-xs font-semibold text-[color:var(--tint)] hover:underline"
        >
          {whole
            ? "Show this week only"
            : `Show the whole topic (${line.wholeTopic.length} points)`}
        </button>
      )}
    </div>
  );
}

function PointList({ points }: { points: PlanPoint[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {points.map((p) =>
        p.progress ? (
          <PointRow key={p.specPointId} point={p.progress} />
        ) : (
          <BarePointRow key={p.specPointId} code={p.code} title={p.title} />
        ),
      )}
    </ul>
  );
}
