import { useState } from "react";
import { ProgramDAL, handPicked, type RoadmapResult } from "@/lib/programDal";
import type { WeekPlanState } from "./useWeekPlan";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";
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
      if (migrationError || Number(data) < 2)
        throw new Error(
          "The scheduler database update must be installed before replacing an existing week. You can still compare the proposal here.",
        );
      await ProgramDAL.refreshWeek({ ...params, expectedPointIds: proposed ?? [] });
      await week.reload();
      onApplied?.();
      setProposed(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the week.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="premium-card rounded-xl p-3">
      <summary className="cursor-pointer text-sm font-bold">
        Compare with the assessment-driven schedule
      </summary>
      <p className="my-2 text-sm text-muted-foreground">
        Completed, started and manually added work stays. Only unstarted automatic assignments can
        change.
      </p>
      {busy ? (
        <Spinner />
      ) : (
        <button className="btn-premium px-3 py-2 text-sm" onClick={compare}>
          Preview proposed week
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
          <button disabled={busy} className="btn-solid px-3 py-2 text-sm" onClick={apply}>
            Apply updated week
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
