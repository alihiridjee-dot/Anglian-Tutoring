import { Check, History } from "lucide-react";
import { boardLabel, levelLabel } from "@/lib/curriculum/courseSummary";
import { type PastWeekGap } from "@/lib/planner/pastWeek";
import { PausedWeek } from "./PausedWeek";
import { BreakWeek } from "./BreakWeek";

/**
 * In place of "No plan was set", for a week gone by that was empty on purpose
 * ({@link PastWeekGap}): the break card, the paused card in the past tense, or
 * the old course's week as it was set.
 */
export function PastWeek({
  gap,
  subject,
  own = false,
}: {
  gap: PastWeekGap;
  subject: string;
  /** The student's own view ("your old course"), not a tutor's ("their"). */
  own?: boolean;
}) {
  if (gap.kind === "break") return <BreakWeek brk={gap.brk} />;
  if (gap.kind === "paused")
    return <PausedWeek subject={subject} pause={gap.pause} past={{ endedAt: gap.pause.endedAt }} />;
  return <OldCourseWeek gap={gap} own={own} />;
}

/**
 * A week saved before a board or level change: what it set, under the course
 * it was set for. Read-only, like any week gone by, with its ticks kept.
 */
function OldCourseWeek({
  gap,
  own,
}: {
  gap: Extract<PastWeekGap, { kind: "old-course" }>;
  own: boolean;
}) {
  const n = gap.points.length;
  return (
    <div className="tint-slate rounded-xl premium-card p-4">
      <div className="flex items-center gap-2.5">
        <span className="icon-tile inline-flex size-9 shrink-0">
          <History className="size-5" aria-hidden />
        </span>
        <h3 className="text-base font-bold">Planned for {own ? "your" : "their"} old course</h3>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="chip">
          {[boardLabel(gap.board), levelLabel(gap.level)].filter(Boolean).join(" · ")}
        </span>
        <span className="chip">
          {n} {n === 1 ? "point" : "points"}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {gap.points.map((p) => (
          <li key={p.spec_point_id} className="flex items-center gap-2 py-2 text-sm">
            <span className="shrink-0 text-[11px] font-bold text-muted-foreground">{p.code}</span>
            <span className="min-w-0 flex-1">{p.title}</span>
            {p.done_at && (
              <span className="chip tint-emerald shrink-0">
                <Check className="size-3.5" strokeWidth={3} aria-hidden /> Done
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
