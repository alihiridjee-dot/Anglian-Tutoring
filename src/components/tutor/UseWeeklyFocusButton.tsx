import { useMemo } from "react";
import { CalendarRange, Check } from "lucide-react";
import { useWeeklyFocus } from "@/hooks/data/useWeeklyFocus";
import { currentWeekKey } from "@/lib/week";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";

/**
 * One-click "use this week's focus" for the tutor resource forms (MCQ, homework,
 * video). Reads the "This Week" plan for the current taxonomy and fills the
 * form's spec-point selection with those points, so a tutor doesn't re-pick what
 * they already chose in the This Week panel.
 *
 * It unions with the current selection rather than replacing it, so any points a
 * tutor added by hand survive. Renders nothing when no plan is set for this
 * subject/board/level, and shows a done state once every focus point is selected.
 */
export function UseWeeklyFocusButton({
  subject,
  board,
  level,
  value,
  onApply,
}: {
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  value: string[];
  onApply: (ids: string[]) => void;
}) {
  const { plans, loading } = useWeeklyFocus(currentWeekKey());

  const plan = useMemo(
    () => plans.find((p) => p.subject === subject && p.board === board && p.level === level),
    [plans, subject, board, level],
  );

  const focusIds = useMemo(() => plan?.points.map((p) => p.id) ?? [], [plan]);

  if (loading || focusIds.length === 0) return null;

  const selected = new Set(value);
  const allSelected = focusIds.every((id) => selected.has(id));

  const apply = () => onApply([...new Set([...value, ...focusIds])]);

  return (
    <div className="flex items-center gap-2 flex-wrap -mb-1">
      <button
        type="button"
        onClick={apply}
        disabled={allSelected}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition disabled:opacity-60 disabled:hover:bg-primary/5"
      >
        {allSelected ? <Check className="w-3.5 h-3.5" /> : <CalendarRange className="w-3.5 h-3.5" />}
        {allSelected
          ? `This week's ${focusIds.length} spec point${focusIds.length === 1 ? "" : "s"} added`
          : `Use this week's spec points (${focusIds.length})`}
      </button>
      {plan?.note && (
        <span className="text-[11px] text-muted-foreground italic truncate max-w-xs">
          {plan.note}
        </span>
      )}
    </div>
  );
}
