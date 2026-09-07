import { RefreshCw } from "lucide-react";
import { PLANNER_TIME_ZONE, weekKeyToDate } from "@/lib/week";
import { type PacingChange } from "@/lib/planner/pacing";

/**
 * The one place a spine change is put into words.
 *
 * It existed twice — once in the roadmap, once in the student planner — and the
 * copies said the same wrong thing: every change rendered as "Moved from
 * {from}", including changes where the start week had not moved. A topic that
 * kept its September start and simply ran a week longer was told it had moved
 * from September, which is the week it is still in.
 *
 * Rendering now follows {@link PacingChange.kind}, so a case cannot be
 * described as another one, and living in a single component means the two
 * surfaces cannot drift apart again.
 */
export function PacingChangeBadge({ change }: { change: PacingChange }) {
  const fmt = (weekKey: string) =>
    weekKeyToDate(weekKey).toLocaleDateString(undefined, {
      timeZone: PLANNER_TIME_ZONE,
      day: "numeric",
      month: "short",
    });

  const delta = change.fromWeeks === null ? 0 : change.weeks - change.fromWeeks;
  const weeks = (n: number) => `${n} week${n === 1 ? "" : "s"}`;

  const { label, title } =
    change.kind === "added"
      ? { label: "New in plan", title: "Newly added to the plan" }
      : change.kind === "moved"
        ? {
            label: `Moved from ${fmt(change.from!)}`,
            title: `Rescheduled from the week of ${fmt(change.from!)}`,
          }
        : {
            // Same start week — only the run length changed, and that is what
            // the badge has to say.
            label: `${delta > 0 ? "+" : "−"}${weeks(Math.abs(delta))}`,
            title: `Starts the same week, but now runs ${weeks(change.weeks)} instead of ${weeks(
              change.fromWeeks ?? change.weeks,
            )}`,
          };

  return (
    <span
      className="mt-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
      title={title}
    >
      <RefreshCw className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}
