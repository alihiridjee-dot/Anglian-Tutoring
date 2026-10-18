import { type Json } from "@/integrations/supabase/types";
import { type SubjectV, type BoardV, type LevelV } from "../curriculum/taxonomy";
import { readPlannerState, type PlannerStateRows } from "./readModels";
import { ScheduleDAL, type TopicProgress } from "./scheduleDal";
import {
  WeeklyPlanDAL,
  evidencedIn,
  type CourseFacts,
  type PointTopic,
  type SavedWeek,
} from "./weeklyPlanDal";
import { toPauseRecord, type PauseRecord } from "./pausesDal";
import { type SubjectPause } from "./subjectPauses";
import { toBreak } from "./breaksDal";
import { type StudentBreak } from "./breaks";
import { toOverride } from "./planOverridesDal";
import { type PlanOverride } from "./overrides";
import { ledgerFrom, type DeliveryLedger } from "./weeklyActivityDal";
import { type PacingBand } from "./pacing";
import { currentWeekKey } from "./week";

type Course = { studentId: string; subject: SubjectV; board: BoardV; level: LevelV };

/**
 * One course as it stands this week, read in one trip (`planner_state`).
 *
 * The planner used to ask for these one at a time, most of them waiting on the
 * one before: about fourteen trips in a row to open it, and thirty the first
 * time in a week (API logs, 17 Oct). Each answer took the database a few
 * milliseconds; the trips took seconds. Everything the full plan
 * ([[programDal]]) and this week (useWeekPlan) are built from is here, worked
 * out from the one answer.
 */
export interface CourseState {
  course: Course;
  /** The Monday it was read for: this week, when it was read. */
  weekStart: string;
  progress: TopicProgress[];
  /** The programme as stored (`student_program_plan`), or null before a first view. */
  baseline: { program_start: string; exam_date: string; pacing: Json } | null;
  /** The exam year given at sign-up, which dates the exams while there is no programme. */
  examYear: number | null;
  /** The subject's stops, oldest first. */
  pauses: PauseRecord[];
  /** The stop in force now, if any. */
  pause: SubjectPause | null;
  /** The student's breaks that stand. */
  breaks: StudentBreak[];
  overrides: PlanOverride[];
  ledger: DeliveryLedger;
  /** This week as saved, split as {@link WeeklyPlanDAL.getPlan} splits it. */
  week: SavedWeek | null;
  /** What a point is checked against on its way into this course's weeks. */
  facts: CourseFacts;
}

export async function readCourseState(course: Course, now = new Date()): Promise<CourseState> {
  const weekStart = currentWeekKey(now);
  return courseStateFrom(await readPlannerState(course, weekStart), course, weekStart, now);
}

/**
 * The state from `planner_state`'s answer. Reads nothing more, unless this week
 * was saved for another course (moved mid-week) and holds a review: the
 * evidence for that is the other course's.
 */
export async function courseStateFrom(
  rows: PlannerStateRows,
  course: Course,
  weekStart: string,
  now = new Date(),
): Promise<CourseState> {
  const pauses = rows.pauses.map(toPauseRecord);
  const breaks = rows.breaks.map(toBreak);
  const progress = await ScheduleDAL.progressFrom({
    ...course,
    snapshot: rows.course,
    pauses,
    breaks,
    now,
  });
  const facts: CourseFacts = {
    pacing: (rows.programme?.pacing ?? []) as unknown as PacingBand[],
    examDate: rows.programme?.exam_date,
    boards: rows.boards,
    level: rows.profile?.level,
    evidenced: evidencedIn(progress),
    topics: new Map<string, PointTopic>(
      rows.course.points.map((p) => [
        p.id,
        { topicId: p.topic_id, subject: course.subject, board: course.board, level: course.level },
      ]),
    ),
    schedulerVersion: rows.scheduler_version,
  };
  const plan = rows.week?.plan;
  const onCourse = plan?.board === course.board && plan?.level === course.level;
  const week =
    rows.week &&
    (await WeeklyPlanDAL.weekFrom(
      course.studentId,
      rows.week,
      onCourse ? facts : { ...facts, evidenced: undefined },
    ));
  const open = pauses.find((p) => !p.endedAt);
  return {
    course,
    weekStart,
    progress,
    baseline: rows.programme,
    examYear: rows.profile?.exam_year ?? null,
    pauses,
    pause: open ? { reason: open.reason, startedAt: open.startedAt } : null,
    breaks,
    overrides: rows.overrides.map(toOverride),
    ledger: ledgerFrom(rows.ledger, weekStart),
    week,
    facts,
  };
}
