import { AlertTriangle, Ban, Loader2, Undo2 } from "lucide-react";
import { type PlanOverride } from "@/lib/planner/overrides";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { type TutorPlannerState } from "./useTutorPlanner";

/** What the tutor has set aside — removed from this week, or skipped in the programme — with the way back. */
export function OverridesPanel({ state }: { state: TutorPlannerState }) {
  const { weekOverrides, labels, actions, editable, weekLabel, active } = state;
  const { removed, skipped } = weekOverrides;
  if (removed.length === 0 && skipped.length === 0) return null;
  const busy = actions.busy;
  const item = (o: PlanOverride) => {
    const meta = labels.get(o.specPointId);
    const code = meta?.code ?? o.specPointId.slice(0, 8);
    const restoring = busy?.action === "restore" && busy.overrideId === o.id;
    return (
      <li
        key={o.id}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/10 px-3 py-2"
      >
        <span className="flex-1 min-w-0 sm:min-w-[12rem] text-sm">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">{code}</span>
          <span className="text-muted-foreground line-through decoration-border">
            {meta?.title ?? "Spec point"}
          </span>
          {o.note && <span className="block text-xs text-muted-foreground mt-0.5">{o.note}</span>}
        </span>
        {editable && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => actions.restore(o, code)}
            className="inline-flex items-center gap-1 h-11 sm:pointer-fine:h-7 px-2.5 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {restoring ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Undo2 className="w-3.5 h-3.5" />
            )}
            Restore
          </button>
        )}
      </li>
    );
  };
  return (
    <div className="space-y-3">
      {removed.length > 0 && (
        <section>
          <h3 className="text-sm font-bold mb-2">
            Removed from {weekLabel}{" "}
            <span className="text-muted-foreground font-medium tabular-nums">{removed.length}</span>
          </h3>
          <ul className="space-y-1.5">{removed.map(item)}</ul>
        </section>
      )}
      {skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-bold mb-2 list-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
              Skipped in {active ? subjectLabel(active.subject) : "the programme"}{" "}
              <span className="text-muted-foreground font-medium tabular-nums">
                {skipped.length}
              </span>
            </span>
          </summary>
          <ul className="space-y-1.5">{skipped.map(item)}</ul>
        </details>
      )}
    </div>
  );
}

/** The override controls need a database update that has not been installed. */
export function OverridesUnavailable() {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px]">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <span>
        Removing, moving and skipping spec points needs the planner override database update. Adding
        points still works.
      </span>
    </p>
  );
}
