import { useId } from "react";
import { ChevronDown, History } from "lucide-react";
import { EmptyState } from "@/components/Shared";
import { PlanWeekRow } from "./PlanWeekRow";
import { type PlanMonth } from "./formatSchedule";

/**
 * The weeks from here to the exams, under month headings.
 *
 * One column at every width. The old table was a three-lane grid that could
 * not narrow past a desktop, and scrolled inside itself inside a scrolling
 * page; this scrolls with the page, and the far end of the year waits behind
 * one button rather than being forty rows the tutor must get past.
 */
export function PlanWeekList({
  months,
  hiddenWeeks,
  earlierWeeks,
  showHistory,
  onToggleHistory,
  onShowRest,
}: {
  months: PlanMonth[];
  /** Weeks folded away after the visible months. */
  hiddenWeeks: number;
  /** Weeks before this one that can be unfolded. */
  earlierWeeks: number;
  showHistory: boolean;
  onToggleHistory: () => void;
  onShowRest: () => void;
}) {
  const idBase = useId();
  if (months.length === 0)
    return (
      <EmptyState
        compact
        title="No weeks left before the exam"
        body="The exam week has passed, so there is nothing ahead to plan."
      />
    );

  return (
    <section aria-label="Weeks to the exams" className="space-y-5">
      {earlierWeeks > 0 && (
        <button
          type="button"
          onClick={onToggleHistory}
          aria-expanded={showHistory}
          className="btn-ghost inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs"
        >
          <History className="size-3.5" aria-hidden />
          {showHistory
            ? "Hide earlier weeks"
            : `Show ${earlierWeeks} earlier ${earlierWeeks === 1 ? "week" : "weeks"}`}
        </button>
      )}

      {months.map((month) => {
        const headingId = `${idBase}-${month.key}`;
        return (
          <section key={month.key} aria-labelledby={headingId}>
            <h3 id={headingId} className="eyebrow mb-2">
              {month.label}
            </h3>
            <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {month.weeks.map((week) => (
                <PlanWeekRow key={week.key} week={week} />
              ))}
            </ol>
          </section>
        );
      })}

      {hiddenWeeks > 0 && (
        <button
          type="button"
          onClick={onShowRest}
          className="btn-soft flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm"
        >
          <ChevronDown className="size-4" aria-hidden />
          Show the rest of the plan · {hiddenWeeks} more {hiddenWeeks === 1 ? "week" : "weeks"}
        </button>
      )}
    </section>
  );
}
