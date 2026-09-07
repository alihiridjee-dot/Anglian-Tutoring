import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ProgramDAL } from "@/lib/programDal";
import { ScheduleDAL } from "@/lib/scheduleDal";
import { currentWeekKey } from "@/lib/week";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";

export interface PlannerCourse { studentId: string; subject: SubjectV; board: BoardV; level: LevelV }
export const plannerKey = (studentId: string) => ["planner", studentId] as const;
export const courseKey = (p: PlannerCourse) => [...plannerKey(p.studentId), p.subject, p.board, p.level] as const;
export const progressQuery = (p: PlannerCourse) => queryOptions({
  queryKey: [...courseKey(p), "progress", currentWeekKey()],
  queryFn: () => ScheduleDAL.getTopicProgress(p),
  staleTime: 30_000,
});
export const roadmapQuery = (client: QueryClient, p: PlannerCourse, projectOnly = false) => queryOptions({
  queryKey: [...courseKey(p), "roadmap", currentWeekKey(), projectOnly],
  queryFn: async ({ signal }) => {
    const progress = await client.fetchQuery(progressQuery(p));
    signal.throwIfAborted();
    return ProgramDAL.loadRoadmap({ ...p, progress, projectOnly });
  },
  staleTime: 30_000,
});
export const memoryQuery = (client: QueryClient, p: PlannerCourse) => queryOptions({
  queryKey: [...courseKey(p), "memory", currentWeekKey()],
  queryFn: async () => ScheduleDAL.getMemoryStats({ ...p, progress: await client.fetchQuery(progressQuery(p)) }),
  staleTime: 30_000,
});
export const invalidatePlanner = (client: QueryClient, studentId: string) =>
  client.invalidateQueries({ queryKey: plannerKey(studentId) });
