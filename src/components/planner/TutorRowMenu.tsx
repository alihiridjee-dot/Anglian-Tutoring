import { useEffect, useRef, useState } from "react";
import { ArrowRight, Ban, CalendarDays, Loader2, MoreHorizontal, X } from "lucide-react";
import { weekKeyToDate, weekRangeLabel } from "@/lib/planner/week";
import { type TutorWeekRow } from "./tutorWeekRows";
import { type TutorOverrideActions } from "./useTutorOverrides";

const label = (key: string) => weekRangeLabel(weekKeyToDate(key));

/**
 * One row's controls, behind a single "⋯" button and named in words.
 *
 * Three unlabelled icons per row were the tutor's whole vocabulary before, and
 * a screen of forty rows read as a hundred and twenty small mysteries. A menu
 * that says "Move to next week" costs one click more and no guessing.
 */
export function TutorRowMenu({
  row,
  actions,
  weekChoices,
  weekStart,
}: {
  row: TutorWeekRow;
  actions: TutorOverrideActions;
  /** Mondays the point can move to, in order. */
  weekChoices: string[];
  weekStart: string;
}) {
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [target, setTarget] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const busy = actions.busy;
  const mine = busy && "specPointId" in busy && busy.specPointId === row.specPointId;
  const disabled = busy !== null;
  const nextWeek = weekChoices.find((w) => w > weekStart) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setChoosing(false);
  };
  const run = async (fn: () => Promise<void>) => {
    close();
    await fn();
  };
  const item =
    "w-full flex min-h-11 sm:min-h-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Change ${row.code}`}
        className="size-11 sm:size-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center disabled:opacity-40"
      >
        {mine ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <MoreHorizontal className="w-4 h-4" />
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 w-64 max-w-[calc(100vw-2rem)] rounded-xl premium-card shadow-lg overflow-hidden py-1"
        >
          {choosing ? (
            <div className="px-3 py-2 space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Move {row.code} to
              </label>
              <select
                autoFocus
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full h-11 sm:h-8 rounded-lg premium-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {weekChoices.map((w) => (
                  <option key={w} value={w}>
                    {label(w)}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setChoosing(false)}
                  className="h-11 sm:h-8 px-2.5 rounded-lg border border-border text-xs font-medium hover:bg-muted"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!target}
                  onClick={() => run(() => actions.move(row, target))}
                  className="h-11 sm:h-8 px-3 rounded-lg btn-solid text-xs font-semibold disabled:opacity-50"
                >
                  Move
                </button>
              </div>
            </div>
          ) : (
            <>
              {nextWeek && (
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => run(() => actions.move(row, nextWeek))}
                >
                  <ArrowRight className="w-4 h-4 text-muted-foreground" aria-hidden />
                  <span>
                    Move to next week
                    <span className="block text-[11px] text-muted-foreground">
                      {label(nextWeek)}
                    </span>
                  </span>
                </button>
              )}
              {weekChoices.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => {
                    setTarget(nextWeek ?? weekChoices[0]);
                    setChoosing(true);
                  }}
                >
                  <CalendarDays className="w-4 h-4 text-muted-foreground" aria-hidden />
                  Move to another week…
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => run(() => actions.remove(row))}
              >
                <X className="w-4 h-4 text-muted-foreground" aria-hidden />
                <span>
                  Remove from this week
                  <span className="block text-[11px] text-muted-foreground">
                    {row.pinned ? "Un-sets your choice" : "The programme won't put it back"}
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => run(() => actions.skip(row))}
              >
                <Ban className="w-4 h-4 text-muted-foreground" aria-hidden />
                <span>
                  Skip in the programme
                  <span className="block text-[11px] text-muted-foreground">
                    Never set automatically, in any week
                  </span>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
