import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  WeeklyPlanDAL,
  type WeeklyPlan,
  type PlanPoint,
  type WithheldPlanPoint,
} from "@/lib/planner/weeklyPlanDal";
import { WeeklyActivityDAL } from "@/lib/planner/weeklyActivityDal";
import { ProgramDAL } from "@/lib/planner/programDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { type PointCoverage, type PointActivity, type PointWork } from "@/lib/planner/coverage";
import { getSessionUserId } from "@/lib/auth/session";
import { courseKey, invalidatePlanner, roadmapQuery } from "@/lib/planner/queries";
import { weekIsForAnotherCourse } from "@/lib/planner/weekCut";
import { subjectPauseQuery, type SubjectPause } from "@/lib/planner/subjectPauses";
import { breakCovering, type StudentBreak } from "@/lib/planner/breaks";
import { studentBreaksQuery } from "@/lib/planner/breakQueries";

export type Activity = Map<string, PointActivity & PointWork>;

export interface WeekPlanState {
  plan: WeeklyPlan | null;
  points: PlanPoint[];
  withheld: WithheldPlanPoint[];
  activity: Activity;
  coverage: Map<string, PointCoverage>;
  roadmap: RoadmapResult | null;
  /** The subject is stopped (plan paused, lapsed, ended or removed): nothing is planned. */
  pause: SubjectPause | null;
  /** The week falls in a break the student is taking: nothing is planned for it. */
  onBreak: StudentBreak | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
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
  enabled?: boolean;
  withCoverage: boolean;
  roadmap?: RoadmapResult | null;
  refreshKey?: number;
}): WeekPlanState {
  const client = useQueryClient();
  const { studentId, subject, board, level, weekStart, isCurrent, withCoverage } = params;
  const weekKey = [...courseKey(params), "week", weekStart];
  const week = useQuery({
    queryKey: weekKey,
    enabled: !!studentId && params.enabled !== false,
    queryFn: async ({ signal }) => {
      let saved = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
      // A paused subject is read, never planned: no week is built and nothing
      // is added to one until the student can use it again. The database
      // refuses those writes too; this is so the planner doesn't try.
      if (await client.fetchQuery(subjectPauseQuery(studentId, subject))) return saved;
      // A break week is read, never planned, in the same way (student_breaks).
      if (breakCovering(await client.fetchQuery(studentBreaksQuery(studentId)), weekStart))
        return saved;
      /**
       * A saved review with nothing behind it is repaired before the week is
       * read, not left sitting there.
       *
       * The trigger is the withheld list alone. Since [[admissibility]],
       * `getPlan` splits a week in two, and a `focus` point with no assessed
       * evidence is exactly what lands in `withheld`. A `focus` point still in
       * `points` has already passed that same evidence test, so testing for one
       * there fired the repair — a second full roadmap load — on every visit to
       * any week holding a review, only for `refreshWeek` to find nothing to do.
       * Quarantine stops an unsupported review being *shown* as revision; this
       * turns it into honest teaching so it actually gets covered.
       */
      const unsupported = saved?.withheld.some((w) => w.reason === "no-evidence");
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
        // No curriculum came back (hidden from this student, or the read
        // failed), so there is nothing to plan from. An empty week saved now
        // would never be rebuilt: on the test account one sat there all week.
        if (!roadmap) return null;
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
      /**
       * A week a person started, not the programme, is completed by it.
       *
       * A tutor pinning a point into next week, or a student carrying loose
       * points forward, creates that week's plan row with a `tutor` or
       * `student` source. The branch above then finds a saved week and never
       * cuts it, so the student reached a week holding only the pins and none
       * of the teaching. The programme's source is `ai`; any other source on a
       * current week means the automatic lanes have not been through it yet,
       * and `refreshWeek` merges them in around what the person chose.
       */
      /**
       * A week saved for another course is re-cut for this one. After a tutor
       * moves a student to another board or level mid-week, every point in the
       * week is withheld as off-course, so the student saw "Nothing assigned
       * this week" until Monday, and the tutor's add, move and catch-up were
       * refused. `save_weekly_plan` moves the row onto the new course, and the
       * old course's points with history stay withheld, not deleted.
       */
      const otherCourse = !!saved && weekIsForAnotherCourse(saved.plan, { board, level });
      if (
        saved &&
        (saved.plan.source !== "ai" || otherCourse) &&
        isCurrent &&
        (await getSessionUserId()) === studentId
      ) {
        const roadmap = await client.fetchQuery(roadmapQuery(client, params, true));
        signal.throwIfAborted();
        if (await ProgramDAL.refreshWeek({ ...params, roadmap })) {
          saved = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
          await client.invalidateQueries({ queryKey: [...courseKey(params), "roadmap"] });
        }
      }
      if (saved && isCurrent && (await getSessionUserId()) === studentId) {
        const roadmap = await client.fetchQuery(roadmapQuery(client, params));
        signal.throwIfAborted();
        if (
          await ProgramDAL.ensureCatchUp({
            planId: saved.plan.id,
            weekStart,
            points: [...saved.points, ...saved.withheld.map((w) => w.point)],
            roadmap,
          })
        ) {
          saved = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
          await client.invalidateQueries({ queryKey: [...courseKey(params), "roadmap"] });
        }
      }
      return saved;
    },
    retry: false, // A query that can materialise a week must not replay writes automatically.
  });
  const points = useMemo(() => week.data?.points ?? [], [week.data]);
  const withheld = useMemo(() => week.data?.withheld ?? [], [week.data]);
  const ids = [...points, ...withheld.map((r) => r.point)].map((p) => p.spec_point_id).sort();
  const activity = useQuery({
    queryKey: [...courseKey(params), "activity", ids],
    queryFn: () => WeeklyActivityDAL.getActivity(ids),
    enabled: !!week.data,
    // The practice queue writes a point's missing quiz and task once the week is
    // saved (a database trigger); re-reading shows them without a reload. Only
    // the current week: a past week is never queued again, so its gaps stay. At
    // most twenty reads, so a point that never gets one stops costing requests.
    refetchInterval: ({ state }) =>
      isCurrent &&
      state.dataUpdateCount + state.errorUpdateCount < 20 &&
      points.some(({ spec_point_id: id }) => {
        const work = state.data?.get(id);
        return (work?.homework.length ?? 0) === 0 || !work?.hasQuiz;
      })
        ? 30_000
        : false,
  });
  const coverage = useQuery({
    queryKey: [...weekKey, "coverage", ids],
    queryFn: () => WeeklyActivityDAL.getCoverage(studentId, ids, weekStart),
    enabled: !!week.data && withCoverage,
  });
  const pause = useQuery({
    ...subjectPauseQuery(studentId, subject),
    enabled: !!studentId && params.enabled !== false,
  });
  const breaks = useQuery({
    ...studentBreaksQuery(studentId),
    enabled: !!studentId && params.enabled !== false,
  });
  const onBreak = breakCovering(breaks.data ?? [], weekStart);
  const road = useQuery({
    ...roadmapQuery(client, params),
    // `enabled` binds the roadmap too: without it, a panel with no course to
    // show still seeded a programme for its fallback subject.
    enabled: !!studentId && params.enabled !== false && params.roadmap === undefined,
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
  const done = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      if (week.data) await WeeklyPlanDAL.setPointDone(week.data.plan.id, id, value);
    },
    /**
     * Tick the box at once. The round trip used to be the only thing that
     * moved it, and `reload` refetches the whole planner, so for a second or
     * two the box still read its old state. A second tap in that window sent
     * the same value again: a double-tap left the point ticked. The cache is
     * updated before the write and put back if the write fails.
     */
    onMutate: async ({ id, value }) => {
      await client.cancelQueries({ queryKey: weekKey });
      const previous = client.getQueryData<typeof week.data>(weekKey);
      if (previous)
        client.setQueryData(weekKey, {
          ...previous,
          points: previous.points.map((p) =>
            p.spec_point_id === id ? { ...p, done_at: value ? new Date().toISOString() : null } : p,
          ),
        });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(weekKey, context.previous);
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
    pause: pause.data ?? null,
    onBreak,
    loading:
      week.isLoading ||
      activity.isLoading ||
      coverage.isLoading ||
      road.isLoading ||
      pause.isLoading ||
      breaks.isLoading,
    error: week.error ?? activity.error ?? coverage.error ?? road.error,
    reload,
    setPointDone: async (id, value) => {
      try {
        await done.mutateAsync({ id, value });
      } catch (e) {
        // The box has already been put back (onError); say why.
        toast.error(e instanceof Error ? e.message : "Couldn't save that tick — try again.");
      }
    },
  };
}
