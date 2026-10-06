import { useMemo } from "react";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useViewerId } from "@/hooks/useViewer";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { demoWeek } from "@/lib/demo/plannerDemo";
import { currentWeekKey } from "@/lib/planner/week";
import { dueSlots, type DueSlot } from "@/lib/planner/dueLanes";
import type { BoardV, LevelV, SubjectV } from "@/lib/curriculum/taxonomy";
import { useWeekPlan, type Activity } from "./useWeekPlan";
import { useWeekLanes, type TopicGroup } from "./useWeekLanes";

const NOTHING_DUE = { tasks: new Map<string, DueSlot>(), quizzes: new Map<string, DueSlot>() };
const NO_WORK: Activity = new Map();

const flat = (groups: TopicGroup[]) => groups.flatMap((g) => g.points);

/**
 * This week's tasks and quizzes for one subject, each filed under the lane the
 * dashboard shows its spec point in. It is what the Tasks and MCQs pages call
 * Due.
 *
 * Deliberately the dashboard's own week rather than a second reading of it: the
 * same `useWeekPlan` (same cache, so arriving from the dashboard costs nothing)
 * sorted by the same `useWeekLanes`. That also means opening either page first
 * thing on a Monday builds the week, exactly as opening the dashboard does. A
 * paused subject or a break week has nothing due, which is what the dashboard
 * shows for it. The showcase reads its fixture week and never reaches
 * `useWeekPlan`, which saves plans.
 */
export function useDueThisWeek(subject: string | null) {
  const demo = isDemoStudent();
  const studentId = useViewerId();
  const { enrolments, level } = useEnrolments();
  const enrolment = enrolments.find((e) => e.subject === subject);
  const weekStart = currentWeekKey();

  const live = useWeekPlan({
    studentId: studentId ?? "",
    subject: (enrolment?.subject ?? "biology") as SubjectV,
    board: (enrolment?.board ?? "edexcel") as BoardV,
    level: (level ?? "gcse") as LevelV,
    weekStart,
    isCurrent: true,
    withCoverage: false,
    // The fallbacks above must never be planned for: no course, no week.
    enabled: !demo && !!studentId && !!enrolment && !!level,
  });
  const fixture = useMemo(
    () => (demo && subject ? demoWeek(subject as SubjectV) : null),
    [demo, subject],
  );
  const week = fixture ?? live;
  // `useWeekPlan` hands back a fresh empty map until its work has loaded; one
  // shared empty map keeps the slots below from changing on every render.
  const activity = week.activity.size ? week.activity : NO_WORK;

  const { coreThisWeek, extraCore, returning, focus, tutor, yours } = useWeekLanes({
    plan: week.plan,
    points: week.points,
    activity,
    coverage: week.coverage,
    roadmap: week.roadmap,
    weekStart,
  });
  const frozen = !fixture && (!!live.pause || !!live.onBreak);

  const slots = useMemo(
    () =>
      frozen
        ? NOTHING_DUE
        : dueSlots(
            {
              new: [...coreThisWeek, ...flat(extraCore)],
              returning: flat(returning),
              revision: flat(focus),
              tutor: flat(tutor),
              yours: flat(yours),
            },
            activity,
          ),
    [frozen, coreThisWeek, extraCore, returning, focus, tutor, yours, activity],
  );

  return {
    slots,
    weekStart,
    loading: !fixture && live.loading,
    error: fixture ? null : live.error,
    reload: live.reload,
  };
}
