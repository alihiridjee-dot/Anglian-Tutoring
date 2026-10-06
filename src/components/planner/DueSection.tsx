import { useId, type ReactNode } from "react";
import {
  BookMarked,
  ChevronDown,
  CircleDot,
  History,
  Plus,
  Repeat,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntryState } from "@/hooks/useEntryState";
import { DUE_LANE_LABEL, type DueLane } from "@/lib/planner/dueLanes";

/** A lane card in its own colour, washed at the top behind its heading. */
const LANE_CARD = "premium-card wash-top";
/** The quieter box the dashboard gives the tutor's points and the student's own. */
const SIDE_BOX = "border border-border bg-muted/20";

/** Each lane's icon and colour, the dashboard's (see `ThisWeekLanes`). */
const LANE_LOOK: Record<DueLane, { icon: LucideIcon; className: string }> = {
  new: { icon: CircleDot, className: `${LANE_CARD} tint-primary` },
  returning: { icon: History, className: `${LANE_CARD} tint-amber` },
  revision: { icon: Repeat, className: `${LANE_CARD} tint-rose` },
  tutor: { icon: BookMarked, className: `${SIDE_BOX} tint-accent` },
  yours: { icon: Plus, className: `${SIDE_BOX} tint-slate` },
};

/**
 * One lane of Due, in the dashboard's colour, icon and name. The work inside
 * takes the lane's colour, as the dashboard's rows do.
 *
 * The heading is built from the kit to read as a section of a revision guide:
 * the lane's icon in a solid tile, its name in display type, and how much is
 * left as a chip. Open to begin with, so the week's work is on screen, and
 * folds away from the heading. A folded lane with work still in it pulses
 * lightly in its own colour, so tidying a lane away never reads as having
 * finished it (Ali, 6 Oct 2026). Open or folded is kept with the visit, so Back
 * from a task finds it as left.
 *
 * Tasks and MCQs both use it, so the two pages split the week the same way and
 * the student meets one set of names and colours: the dashboard's.
 */
export function DueSection({
  lane,
  count,
  children,
}: {
  lane: DueLane;
  count: number;
  children: ReactNode;
}) {
  const { icon: Icon, className } = LANE_LOOK[lane];
  const [open, setOpen] = useEntryState(`due.${lane}`, true);
  const body = useId();
  return (
    <section
      className={cn("min-w-0 rounded-xl p-4", className, !open && count > 0 && "pulse-ring")}
    >
      <h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={body}
          className="group flex w-full items-center gap-3 text-left"
        >
          <span className="icon-tile icon-tile-solid size-10 shrink-0">
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="font-display min-w-0 text-base leading-tight font-extrabold sm:text-lg">
            {DUE_LANE_LABEL[lane]}
          </span>
          <span className="chip shrink-0">
            <span className="numeral">{count}</span> to do
          </span>
          {/* The open/fold control: a round button in the lane's colour. */}
          <span className="ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--tint)_12%,transparent)] text-[color:var(--tint)] transition-colors group-hover:bg-[color-mix(in_oklab,var(--tint)_20%,transparent)] sm:pointer-fine:size-8">
            <ChevronDown
              className={cn("size-4 transition-transform", !open && "-rotate-90")}
              aria-hidden
            />
          </span>
        </button>
      </h2>
      <div id={body} hidden={!open} className="mt-4">
        {children}
      </div>
    </section>
  );
}

/**
 * The lanes, stacked, with the subject's colour glowing softly behind them. The
 * lanes wear the dashboard's colours; the glow keeps the page the subject's.
 */
export function DueLanes({ children }: { children: ReactNode }) {
  return <div className="glow-behind space-y-5">{children}</div>;
}
