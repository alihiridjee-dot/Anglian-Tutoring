import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ProgramDAL } from "@/lib/planner/programDal";
import { ScheduleDAL } from "@/lib/planner/scheduleDal";
import { readCourseState } from "@/lib/planner/courseState";
import { currentWeekKey } from "@/lib/planner/week";
import type { SubjectV, BoardV, LevelV } from "@/lib/curriculum/taxonomy";

export interface PlannerCourse {
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
}
export const plannerKey = (studentId: string) => ["planner", studentId] as const;
export const courseKey = (p: PlannerCourse) =>
  [...plannerKey(p.studentId), p.subject, p.board, p.level] as const;
/**
 * The course as it stands this week, in one read ([[courseState]]). The full
 * plan, the week, its pause and breaks and the practice history are all worked
 * out from it, so opening the planner costs one trip, and a page opened while
 * another is still loading picks up the same read instead of starting again.
 */
export const stateQuery = (p: PlannerCourse) =>
  queryOptions({
    queryKey: [...courseKey(p), "state", currentWeekKey()],
    queryFn: () =>
      readCourseState({
        studentId: p.studentId,
        subject: p.subject,
        board: p.board,
        level: p.level,
      }),
    staleTime: 30_000,
  });
export const roadmapQuery = (client: QueryClient, p: PlannerCourse, projectOnly = false) =>
  queryOptions({
    queryKey: [...courseKey(p), "roadmap", currentWeekKey(), projectOnly],
    queryFn: async ({ signal }) => {
      const state = await client.fetchQuery(stateQuery(p));
      signal.throwIfAborted();
      return ProgramDAL.loadRoadmap({ ...p, projectOnly, state });
    },
    staleTime: 30_000,
  });
export const memoryQuery = (client: QueryClient, p: PlannerCourse) =>
  queryOptions({
    queryKey: [...courseKey(p), "memory", currentWeekKey()],
    queryFn: async () =>
      ScheduleDAL.getMemoryStats({
        ...p,
        progress: (await client.fetchQuery(stateQuery(p))).progress,
      }),
    staleTime: 30_000,
  });
export const invalidatePlanner = (client: QueryClient, studentId: string) =>
  client.invalidateQueries({ queryKey: plannerKey(studentId) });

/** What a course's views are built from, and the views built from it alone. */
const FROM_STATE = new Set(["state", "roadmap", "memory"]);
/**
 * After a write to a course: its state is read again, once, and every view
 * built from it follows. The week that made the write is left to finish and
 * reads the new state itself.
 */
export const courseChanged = (client: QueryClient, p: PlannerCourse) => {
  const course = courseKey(p);
  return client.invalidateQueries({
    predicate: ({ queryKey }) =>
      course.every((part, i) => queryKey[i] === part) &&
      FROM_STATE.has(String(queryKey[course.length])),
  });
};
