import { useCallback, useEffect, useRef, useState } from "react";
import { WeeklyPlanDAL, type WeeklyPlan, type PlanPoint } from "@/lib/weeklyPlanDal";
import { ScheduleDAL } from "@/lib/scheduleDal";
import { ProgramDAL, type RoadmapResult } from "@/lib/programDal";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { type PointCoverage } from "@/lib/planner/coverage";
import { getSessionUserId } from "@/lib/auth/session";

export type Activity = Map<string, { hasHomework: boolean; hasQuiz: boolean }>;

export interface WeekPlanState {
  plan: WeeklyPlan | null;
  points: PlanPoint[];
  activity: Activity;
  coverage: Map<string, PointCoverage>;
  /** The programme this week was cut from — for the core topic's band + mastery. */
  roadmap: RoadmapResult | null;
  loading: boolean;
  reload: () => Promise<void>;
  removePoint: (specPointId: string) => Promise<void>;
}

/**
 * One week of a student's plan, loaded once and shared by every surface that
 * shows it.
 *
 * The dashboard and the planner's "This week" tab used to answer the same
 * question from different data — the dashboard read the saved plan, the planner
 * derived a view straight off the roadmap — so the two could disagree about what
 * a student was meant to be doing. They now both take this hook, and the split
 * between core and focus is read from the points' stored lane.
 */
export function useWeekPlan(params: {
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  /** Monday date-key of the week to show. */
  weekStart: string;
  /** Only the current week builds itself from the programme when it's missing. */
  isCurrent: boolean;
  /** Fold in fresh marks and load per-point coverage (current + past weeks). */
  withCoverage: boolean;
  /** An already-loaded programme, to save this hook fetching it again. */
  roadmap?: RoadmapResult | null;
  /**
   * Bumped once the programme has re-cut this week (see
   * {@link ProgramDAL.refreshWeek}) so a mounted panel picks the new points up.
   * The re-cut itself happens in the planner, not here: this hook lives inside a
   * tab that unmounts when the student goes off to rate topics, so it is exactly
   * the component that cannot observe a rating happening.
   */
  refreshKey?: number;
}): WeekPlanState {
  const { studentId, subject, board, level, weekStart, isCurrent, withCoverage } = params;
  const suppliedRoadmap = params.roadmap;
  const refreshKey = params.refreshKey ?? 0;

  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [points, setPoints] = useState<PlanPoint[]>([]);
  const [activity, setActivity] = useState<Activity>(new Map());
  const [coverage, setCoverage] = useState<Map<string, PointCoverage>>(new Map());
  const [roadmap, setRoadmap] = useState<RoadmapResult | null>(suppliedRoadmap ?? null);
  const [loading, setLoading] = useState(true);

  /**
   * Build the current week from the programme, once, if it isn't there yet.
   *
   * Only ever for the signed-in student's own week: a parent viewing the
   * dashboard is handed their child's `studentId` to read with, but a write
   * binds to the viewer via RLS — so auto-filling unguarded would file the
   * child's plan under the parent. And only the current week, so paging forward
   * to browse doesn't quietly create rows for weeks nobody asked about.
   */
  const materialise = useCallback(async () => {
    if (!isCurrent) return null;
    if ((await getSessionUserId()) !== studentId) return null;
    const { specPointIds, origins, rationale } = await ProgramDAL.planForWeek({
      studentId,
      subject,
      board,
      level,
      weekStart,
    });
    if (specPointIds.length === 0) return null;
    await WeeklyPlanDAL.savePlan({
      subject,
      board,
      level,
      weekStart,
      specPointIds,
      source: "ai",
      rationale,
      // Each point records the lane it came from, so the week can show the split.
      origins,
      origin: "ai",
    });
    return WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
  }, [studentId, subject, board, level, weekStart, isCurrent]);

  const reload = useCallback(async () => {
    setLoading(true);
    let res = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
    if (!res) {
      // Best-effort: an empty week is a fine outcome, a broken panel is not.
      res = await materialise().catch((e) => {
        console.error("build this week from the programme", e);
        return null;
      });
    }
    const pts = res?.points ?? [];
    setPlan(res?.plan ?? null);
    setPoints(pts);

    const ids = pts.map((p) => p.spec_point_id);
    // Fold any new homework/MCQ results into the spaced-repetition schedule
    // first (idempotent), so coverage below reflects them.
    if (withCoverage && ids.length) {
      await ScheduleDAL.syncReviewsFromAttempts(studentId, ids).catch(() => {});
    }
    const [act, cov, road] = await Promise.all([
      WeeklyPlanDAL.getActivity(ids),
      withCoverage && ids.length
        ? WeeklyPlanDAL.getCoverage(studentId, ids)
        : Promise.resolve(new Map<string, PointCoverage>()),
      // The core card needs the week's band and its mastery. `planForWeek` has
      // usually just loaded this; re-reading is cheap next to showing the
      // student a topic heading the programme doesn't agree with.
      suppliedRoadmap !== undefined
        ? Promise.resolve(suppliedRoadmap)
        : ProgramDAL.loadRoadmap({ studentId, subject, board, level }).catch(() => null),
    ]);
    setActivity(act);
    setCoverage(cov);
    setRoadmap(road);
    setLoading(false);
  }, [studentId, subject, board, level, weekStart, withCoverage, suppliedRoadmap, materialise]);

  useEffect(() => {
    let alive = true;
    reload().catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, subject, board, level, weekStart]);

  // The week was re-cut upstream — pull the new points in. Skipped on first
  // render (`seen` starts at the initial key), so a normal mount never double-loads.
  const seenRefresh = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === seenRefresh.current) return;
    seenRefresh.current = refreshKey;
    reload().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const removePoint = useCallback(
    async (specPointId: string) => {
      if (!plan) return;
      setPoints((prev) => prev.filter((p) => p.spec_point_id !== specPointId));
      try {
        await WeeklyPlanDAL.removePoint(plan.id, specPointId);
      } catch {
        await reload();
      }
    },
    [plan, reload],
  );

  return { plan, points, activity, coverage, roadmap, loading, reload, removePoint };
}
