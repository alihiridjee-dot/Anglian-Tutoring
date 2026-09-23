import { AlertTriangle, Ban, Loader2, Plus, Undo2 } from "lucide-react";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type SubjectV, type BoardV } from "@/lib/curriculum/taxonomy";
import { type PlanOverride } from "@/lib/planner/overrides";
import { SpecPointSelect } from "@/components/tutor/SpecPointSelect";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { type TutorPlannerState } from "./useTutorPlanner";
import { type AssignmentWarning } from "./tutorWeekRows";

/** The plan cannot fit before the exam: what is left over, for the tutor to triage. */
export function SchedulingAttention({ roadmap }: { roadmap: RoadmapResult }) {
  return (
    <section className="premium-card tint-amber rounded-xl p-4">
      <h3 className="text-sm font-bold">Scheduling needs attention</h3>
      <p className="text-sm">
        {roadmap.reviewBacklog.length} reviews cannot fit before the exam.{" "}
        {roadmap.unscheduledTopicTitles.length} topics lack teaching time.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-bold">See outstanding work</summary>
        <ul className="list-disc pl-5 text-sm">
          {roadmap.reviewBacklog.map((p) => (
            <li key={p.specPointId}>
              {p.code} {p.pointTitle}
            </li>
          ))}
          {roadmap.unscheduledTopicTitles.map((t) => (
            <li key={t}>{t} — teaching time needed</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

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
        <span className="flex-1 min-w-[12rem] text-sm">
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
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"
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

const WARNING_COPY: Record<AssignmentWarning["reason"], (w: AssignmentWarning) => string> = {
  covered: (w) => `already assessed at ${w.bestScore}%`,
  done: () => "already ticked off by the student",
  skipped: () => "skipped in the programme — this week's pin will still stand",
  "in-week": () => "already in this week",
};

/** Add spec points to the week: the closed button, or the open picker with its warnings. */
export function AddPointsBox({ state }: { state: TutorPlannerState }) {
  const { picking, setPicking, student, active, toAdd, setToAdd, adding, addSelected } = state;
  const { weekLabel, warnings } = state;
  if (!student || !active) return null;
  return picking ? (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      {student.level ? (
        <>
          <SpecPointSelect
            subject={active.subject as SubjectV}
            board={active.board as BoardV}
            level={student.level}
            value={toAdd}
            onChange={setToAdd}
          />
          {warnings.length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2">
              <p className="text-[12px] font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                {warnings.length === 1 ? "One of these" : `${warnings.length} of these`} may not
                need setting
              </p>
              <ul className="mt-1 space-y-0.5 text-[12px]">
                {warnings.map((w) => (
                  <li key={w.specPointId}>
                    <span className="font-semibold">{w.code}</span> {w.title} —{" "}
                    {WARNING_COPY[w.reason](w)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                setToAdd([]);
              }}
              className="h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addSelected}
              disabled={adding || toAdd.length === 0}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg btn-solid text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {warnings.length > 0 ? "Add anyway" : "Add"} {toAdd.length > 0 ? toAdd.length : ""}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This student has no exam level set — set it on their profile before planning.
        </p>
      )}
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setPicking(true)}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted"
    >
      <Plus className="w-4 h-4" /> Add spec points to {weekLabel}
    </button>
  );
}
