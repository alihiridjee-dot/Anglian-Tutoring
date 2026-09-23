import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlanLine } from "./PlanLine";
import { type PlanWeek } from "./formatSchedule";

/**
 * One week of the plan: the date down the left, and a line for each piece of
 * work on the right. A week says only what it holds — no empty columns, no
 * dashes standing in for a lane with nothing in it.
 *
 * The date is a large day number under a month heading, so a column of them
 * reads like a calendar margin and the eye can run down it to a week.
 */
export function PlanWeekRow({ week }: { week: PlanWeek }) {
  return (
    <li
      aria-current={week.isNow ? "date" : undefined}
      className={cn(
        "grid grid-cols-[2.75rem_minmax(0,1fr)] sm:grid-cols-[4.25rem_minmax(0,1fr)]",
        week.isNow && "tint-primary bg-[color:color-mix(in_oklab,var(--tint)_5%,var(--card))]",
      )}
    >
      <div
        className={cn(
          "flex flex-col items-center border-r border-border px-1 py-3 text-center",
          week.isNow && "border-r-[color:color-mix(in_oklab,var(--tint)_30%,var(--border))]",
        )}
      >
        <span className="sr-only">{week.label}</span>
        <span
          aria-hidden
          className={cn(
            "numeral text-xl",
            week.isNow && "text-[color:var(--tint)]",
            week.isPast && "text-muted-foreground",
          )}
        >
          {week.day}
        </span>
        <span aria-hidden className="mt-1 text-[11px] font-semibold text-muted-foreground">
          {week.month}
        </span>
      </div>
      <div className="min-w-0 space-y-1 px-1 py-2 sm:px-2">
        {(week.isNow || week.isExam) && (
          <div className="flex flex-wrap gap-1.5 px-1.5 pt-1 sm:px-2">
            {week.isNow && <span className="chip chip-solid text-[11px]">This week</span>}
            {week.isExam && (
              <span className="chip tint-rose text-[11px]">
                <GraduationCap className="size-3" aria-hidden />
                Exams
              </span>
            )}
          </div>
        )}
        {week.lines.length > 0 ? (
          <ul className="space-y-0.5">
            {week.lines.map((line) => (
              <PlanLine key={line.key} line={line} isNow={week.isNow} />
            ))}
          </ul>
        ) : (
          !week.isExam && (
            <p className="px-1.5 py-1.5 text-sm text-muted-foreground sm:px-2">Nothing planned</p>
          )
        )}
      </div>
    </li>
  );
}
