import { SlidersHorizontal } from "lucide-react";
import { Meter } from "@/components/Shared";
import { type PlanSummary as Summary } from "./formatSchedule";

/**
 * How far through the course the student is, and how long is left — the two
 * numbers the rest of the plan is read against — with the one control that
 * changes the plan's shape.
 *
 * The student's name and subject are already in the pane's header, so this
 * does not repeat them.
 */
export function PlanSummary({
  summary,
  onReorder,
}: {
  summary: Summary;
  /** Null while a re-plan waits to apply: the order cannot be edited under it. */
  onReorder: (() => void) | null;
}) {
  const { covered, total, percent, examDate, weeksLeft } = summary;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-64">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm">
            <span className="numeral text-2xl text-[color:var(--tint)]">{covered}</span>
            <span className="font-semibold">
              {" "}
              of {total} {total === 1 ? "topic" : "topics"} covered
            </span>
          </p>
          <p className="text-sm">
            <span className="font-semibold">Exams {examDate}</span>
            <span className="text-muted-foreground">
              {" "}
              · {weeksLeft} {weeksLeft === 1 ? "week" : "weeks"} to go
            </span>
          </p>
        </div>
        <Meter value={percent} size="sm" />
      </div>
      {onReorder && (
        <button
          type="button"
          onClick={onReorder}
          className="btn-soft inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          Change topic order
        </button>
      )}
    </div>
  );
}
