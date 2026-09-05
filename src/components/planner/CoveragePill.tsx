import { type PointStatus, STATUS_STYLE, UNSCORED } from "@/lib/planner/coverage";

/** A compact status chip for one spec point — how the student did on it. */
export function CoveragePill({ status, score }: { status: PointStatus; score?: number | null }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`chip inline-flex text-[10px] ${s.pill}`} title={s.label}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
      {!UNSCORED.has(status) && score != null && (
        <span className="tabular-nums opacity-70">{score}%</span>
      )}
    </span>
  );
}
