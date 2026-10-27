import { TreePalm } from "lucide-react";
import { backOn, breakDay, breakReasonLabel, type StudentBreak } from "@/lib/planner/breaks";

/**
 * In place of a week that falls in a break. Nothing is planned for it, so
 * there is nothing else to show: no empty lanes, and no sentence explaining
 * them. Just why, and when the student is back.
 */
export function BreakWeek({ brk }: { brk: StudentBreak }) {
  return (
    <div className="tint-accent flex flex-col items-center gap-2.5 py-6 text-center">
      <span className="icon-tile inline-flex w-11 h-11">
        <TreePalm className="w-5 h-5" />
      </span>
      <h3 className="text-base font-bold">On a break</h3>
      <div className="flex flex-wrap justify-center gap-1.5">
        <span className="chip">{breakReasonLabel(brk.reason)}</span>
        <span className="chip">Back {breakDay(backOn(brk))}</span>
      </div>
    </div>
  );
}
