import { useState } from "react";
import { toast } from "sonner";
import { ProgramDAL, handPicked } from "@/lib/planner/programDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import type { WeekPlanState } from "./useWeekPlan";
import type { SubjectV, BoardV, LevelV } from "@/lib/curriculum/taxonomy";
import { supabase } from "@/integrations/supabase/client";
import { Spinner } from "@/components/Shared";

/** Explicit comparison: existing weekly assignments are never silently replaced. */
export function ScheduleComparison({
  studentId,
  subject,
  board,
  level,
  weekStart,
  week,
  roadmap,
  onApplied,
}: {
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  weekStart: string;
  week: WeekPlanState;
  roadmap: RoadmapResult;
  onApplied?: () => void;
}) {
  const [proposed, setProposed] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const params = { studentId, subject, board, level, weekStart };
  const names = new Map(
    roadmap.progress.flatMap((t) => t.points.map((p) => [p.id, p.title] as const)),
  );
  const compare = async () => {
    setBusy(true);
    setError("");
    try {
      const fresh = await ProgramDAL.planForWeek(params);
      const kept = week.points.filter(
        (p) =>
          handPicked(p.origin) ||
          p.done_at ||
          p.carried_from ||
          week.coverage.get(p.spec_point_id)?.attempted,
      );
      setProposed([...new Set([...kept.map((p) => p.spec_point_id), ...fresh.specPointIds])]);
    } catch {
      setError("Could not load the proposed schedule. Your saved week is unchanged.");
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      // Fail closed until the completion-preserving database migration is installed.
      const { data, error: migrationError } = await supabase.rpc(
        "assessment_scheduler_version" as never,
      );
      if (migrationError || !Number.isFinite(Number(data)) || Number(data) < 4)
        throw new Error("This needs a newer version of the planner. Your week is unchanged.");
      await ProgramDAL.refreshWeek({ ...params, expectedPointIds: proposed ?? [] });
      await week.reload();
      onApplied?.();
      setProposed(null);
      toast.success("Your week is updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the week.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="premium-card rounded-xl p-3">
      <summary className="cursor-pointer text-sm font-bold py-3 -my-3 sm:pointer-fine:py-0 sm:pointer-fine:my-0">
        Check for a better week
      </summary>
      <p className="my-2 text-sm text-muted-foreground">
        See what your plan would set this week now that your marks have moved. Anything you’ve done,
        started or added yourself stays.
      </p>
      {busy ? (
        <Spinner />
      ) : (
        <button
          className="btn-premium px-3 py-2 min-h-11 sm:pointer-fine:min-h-0 text-sm"
          onClick={compare}
        >
          Show me the suggested week
        </button>
      )}
      {proposed && (
        <div className="mt-3 space-y-2">
          <p className="text-sm">
            Saved: {week.points.length} points. Proposed: {proposed.length} points.
          </p>
          {proposed.length ? (
            <ul className="list-disc pl-5 text-sm">
              {proposed.map((id) => (
                <li key={id}>
                  {names.get(id) ??
                    week.points.find((p) => p.spec_point_id === id)?.title ??
                    "Assigned point"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No practice points need assigning this week.</p>
          )}
          <button
            disabled={busy}
            className="btn-solid px-3 py-2 min-h-11 sm:pointer-fine:min-h-0 text-sm"
            onClick={apply}
          >
            Use this week
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
    </details>
  );
}
