import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  WeeklyPlanDAL,
  type WeeklyPlan,
  type PlanPoint,
  type WithheldPlanPoint,
} from "@/lib/weeklyPlanDal";
import { ProgramDAL, type RoadmapResult } from "@/lib/programDal";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { type PointCoverage, type PointActivity, type PointWork } from "@/lib/planner/coverage";
import { getSessionUserId } from "@/lib/auth/session";
import { courseKey, invalidatePlanner, roadmapQuery } from "@/lib/planner/queries";

export type Activity = Map<string, PointActivity & PointWork>;
export interface WeekPlanState {
  plan: WeeklyPlan | null;
  points: PlanPoint[];
  withheld: WithheldPlanPoint[];
  activity: Activity;
  coverage: Map<string, PointCoverage>;
  roadmap: RoadmapResult | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  removePoint: (specPointId: string) => Promise<void>;
  setPointDone: (specPointId: string, done: boolean) => Promise<void>;
}

/** React Query owns deduplication, cache lifetime and mutation invalidation. */
export function useWeekPlan(params: {
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  weekStart: string;
  isCurrent: boolean;
  withCoverage: boolean;
  roadmap?: RoadmapResult | null;
  refreshKey?: number;
}): WeekPlanState {
  const client = useQueryClient();
  const { studentId, subject, board, level, weekStart, isCurrent, withCoverage } = params;
  const weekKey = [...courseKey(params), "week", weekStart];
  const week = useQuery({
    queryKey: weekKey,
    enabled: !!studentId,
    queryFn: async ({ signal }) => {
      let saved = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
      /**
       * A saved review with nothing behind it is repaired before the week is
       * read, not left sitting there.
       *
       * The trigger looks at the withheld list as well as the active one. Since
       * [[admissibility]], `getPlan` splits a week in two, and a `focus` point
       * with no assessed evidence is exactly what lands in `withheld` — so a
       * test against `points` alone would never fire, and the repair would be
       * dead code. Quarantine stops it being *shown* as revision; this turns it
       * into honest teaching so it actually gets covered.
       */
      const unsupported =
        saved?.points.some((p) => p.origin === "focus") ||
        saved?.withheld.some((w) => w.reason === "no-evidence");
      if (unsupported && isCurrent && (await getSessionUserId()) === studentId) {
        const roadmap = await client.fetchQuery(roadmapQuery(client, params, true));
        signal.throwIfAborted();
        if (await ProgramDAL.refreshWeek({ ...params, roadmap, repairUnsupportedReviews: true })) {
          saved = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
          await client.invalidateQueries({ queryKey: [...courseKey(params), "roadmap"] });
        }
      }
      if (!saved && isCurrent && (await getSessionUserId()) === studentId) {
        const roadmap = await client.fetchQuery(roadmapQuery(client, params, true));
        const selection = await ProgramDAL.planForWeek({ ...params, roadmap });
        signal.throwIfAborted();
        await WeeklyPlanDAL.savePlan({
          subject,
          board,
          level,
          weekStart,
          specPointIds: selection.specPointIds,
          origins: selection.origins,
          rationale: selection.rationale,
          source: "ai",
          origin: "ai",
        });
        saved = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
        // A newly saved week now owns the current roadmap assignments.
        await client.invalidateQueries({ queryKey: [...courseKey(params), "roadmap"] });
      }
      return saved;
    },
    retry: false, // A query that can materialise a week must not replay writes automatically.
  });
  const points = week.data?.points ?? [];
  const withheld = week.data?.withheld ?? [];
  const ids = [...points, ...withheld.map((r) => r.point)].map((p) => p.spec_point_id).sort();
  const activity = useQuery({
    queryKey: [...courseKey(params), "activity", ids],
    queryFn: () => WeeklyPlanDAL.getActivity(ids),
    enabled: !!week.data,
  });
  const coverage = useQuery({
    queryKey: [...weekKey, "coverage", ids],
    queryFn: () => WeeklyPlanDAL.getCoverage(studentId, ids, weekStart),
    enabled: !!week.data && withCoverage,
  });
  const road = useQuery({
    ...roadmapQuery(client, params),
    enabled: !!studentId && params.roadmap === undefined,
  });
  const reload = useCallback(async () => {
    await invalidatePlanner(client, studentId);
  }, [client, studentId]);
  const refresh = useRef(params.refreshKey);
  useEffect(() => {
    if (refresh.current !== params.refreshKey) {
      refresh.current = params.refreshKey;
      void reload();
    }
  }, [params.refreshKey, reload]);
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (week.data) await WeeklyPlanDAL.removePoint(week.data.plan.id, id);
    },
    onSettled: reload,
  });
  const done = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      if (week.data) await WeeklyPlanDAL.setPointDone(week.data.plan.id, id, value);
    },
    onSettled: reload,
  });
  return {
    plan: week.data?.plan ?? null,
    points,
    withheld,
    activity: activity.data ?? new Map(),
    coverage: withCoverage ? (coverage.data ?? new Map()) : new Map(),
    roadmap: params.roadmap !== undefined ? params.roadmap : (road.data ?? null),
    loading: week.isLoading || activity.isLoading || coverage.isLoading || road.isLoading,
    error: week.error ?? activity.error ?? coverage.error ?? road.error,
    reload,
    removePoint: async (id) => {
      await remove.mutateAsync(id);
    },
    setPointDone: async (id, value) => {
      await done.mutateAsync({ id, value });
    },
  };
}
