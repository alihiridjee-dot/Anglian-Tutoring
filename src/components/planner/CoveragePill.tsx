import { type PointStatus, STATUS_STYLE } from "@/lib/planner/coverage";

/** A compact status chip for one spec point — how the student did on it. */
export function CoveragePill({ status, score }: { status: PointStatus; score?: number | null }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 h-5 pl-1.5 pr-2 rounded-full border text-[10px] font-semibold ${s.pill}`}
      title={s.label}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
      {status !== "not_done" && score != null && (
        <span className="tabular-nums opacity-70">{score}%</span>
      )}
    </span>
  );
}
