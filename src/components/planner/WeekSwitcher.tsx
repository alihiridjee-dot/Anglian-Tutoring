import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeWeekLabel, weekKeyToDate, weekRangeLabel } from "@/lib/planner/week";

/**
 * Which week the tutor is planning: where it sits from today, its dates, and
 * the arrows either side.
 *
 * It used to be a bar across the top of the whole page, above tabs it did not
 * affect — on "Full plan" and "Practice history" it moved nothing. It now sits
 * with the things that follow it: the roster's counts, and, on a phone where
 * the roster is hidden, the student's week.
 */
export function WeekSwitcher({
  weekStart,
  currentWeek,
  onShift,
  onToday,
  className,
}: {
  weekStart: string;
  currentWeek: string;
  onShift: (weeks: number) => void;
  onToday: () => void;
  className?: string;
}) {
  const isCurrent = weekStart === currentWeek;
  return (
    <div className={cn("flex items-center gap-2", className)} role="group" aria-label="Week">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold leading-tight" aria-live="polite">
            {relativeWeekLabel(weekStart, currentWeek)}
          </p>
          {!isCurrent && (
            <button
              type="button"
              onClick={onToday}
              className="btn-ghost inline-flex h-6 items-center rounded-md px-1.5 text-xs"
            >
              Today
            </button>
          )}
        </div>
        <p className="truncate text-xs tabular-nums text-muted-foreground">
          {weekRangeLabel(weekKeyToDate(weekStart))}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onShift(-1)}
        aria-label="Previous week"
        className="btn-soft inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onShift(1)}
        aria-label="Next week"
        className="btn-soft inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
