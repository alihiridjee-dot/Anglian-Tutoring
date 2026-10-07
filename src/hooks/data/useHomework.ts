import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { QUESTION_COLUMNS, withMarkSchemes } from "@/lib/homework/markSchemes";
import {
  isDemoStudent,
  DEMO_ANSWERS,
  DEMO_HOMEWORK,
  DEMO_LEVEL,
  DEMO_QUESTIONS,
  DEMO_SUBMISSIONS,
} from "@/lib/demo/studentDemo";
import type { HomeworkAnswer, HomeworkQuestion } from "@/hooks/data/useHomeworkQuestions";
import type { Homework, HomeworkOrigin, SubmissionRow } from "@/lib/homework/types";
import type { TopicRef } from "@/lib/curriculum/topicGroups";
import type { LevelV } from "@/lib/curriculum/taxonomy";
import { courseParts, type LibraryFilter } from "@/lib/curriculum/libraryFilter";
import { ilikePattern } from "@/lib/search/match";

/** How often an open sheet checks whether its mark has been released. */
const AWAITING_MARK_POLL_MS = 30_000;

/** Both homework queries sit under this prefix so one invalidate refreshes the page. */
const HOMEWORK_KEY = ["homework"] as const;

/**
 * The homework briefs visible to the caller: every brief for a tutor, and only
 * the enrolled subjects at the student's own level for a student.
 *
 * Level is filtered here because a different level is a different
 * qualification. Board is left to the page, which knows what has been handed
 * in. RLS scopes `resources` by subject alone, and the practice queue writes a sheet
 * for every spec point any student reaches on any board. Without both filters,
 * an AQA GCSE student's practice list filled with Edexcel and A-Level sheets.
 *
 * `subjects` must be settled before this runs — an empty list while the profile
 * is still loading would read as "no filter" and flash every subject's homework
 * at the student. Pass `enabled: false` until enrolments have resolved.
 */
export function useHomework({
  isTutor,
  subjects,
  level = null,
  enabled = true,
}: {
  isTutor: boolean;
  subjects: string[];
  /** The student's level. Null (not yet set) filters nothing rather than everything. */
  level?: LevelV | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [...HOMEWORK_KEY, "briefs", { isTutor, subjects: [...subjects].sort(), level }],
    queryFn: async (): Promise<Homework[]> => {
      // Demo student: render the self-contained fixture set, never real content.
      if (isDemoStudent()) return DEMO_HOMEWORK.map(demoHomework);

      let q = supabase
        .from("resources")
        .select("id, title, instructions, subject, board, level, due_at, created_at, origin")
        .eq("kind", "homework")
        .order("due_at", { ascending: true });
      if (!isTutor && subjects.length > 0)
        q = q.in("subject", subjects as ("biology" | "chemistry" | "physics")[]);
      if (!isTutor && level) q = q.eq("level", level);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Homework[];
    },
    enabled,
  });
}

/**
 * The topic each sheet's spec point sits in, keyed by sheet id — what the
 * Marked tab files its marks under. A tutor's brief has no spec point, so it
 * has no entry.
 */
export function useHomeworkTopics(resourceIds: string[], enabled = true) {
  const ids = [...resourceIds].sort();
  return useQuery({
    queryKey: [...HOMEWORK_KEY, "topics", ids],
    queryFn: async (): Promise<Record<string, TopicRef>> => {
      // The showcase's sheets are tutor briefs, with no spec point behind them.
      if (isDemoStudent() || ids.length === 0) return {};
      // Named key: `resource_spec_points` links the two tables as well (see below).
      const { data, error } = await supabase
        .from("resources")
        .select("id, spec_points!resources_spec_point_id_fkey(topics(id, title, sort_order))")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, TopicRef> = {};
      for (const r of data ?? []) {
        const t = r.spec_points?.topics;
        if (t) map[r.id] = { id: t.id, title: t.title, order: t.sort_order };
      }
      return map;
    },
    enabled: enabled && ids.length > 0,
  });
}

/** Rows per request in the tutor's homework library. */
const LIBRARY_PAGE = 50;

/**
 * The tutor's homework library, a page at a time, filtered by who wrote it and
 * by the library's filters.
 *
 * Asked of the server rather than filtered here: the practice queue writes a sheet for
 * every spec point, and a single read of every brief stopped at PostgREST's
 * 1,000-row cap (S-17b), so past that the newest sheets never reached the list.
 * `id` breaks ties so a page never repeats or skips a row with the same date.
 */
export function useHomeworkLibrary({
  origin,
  filter,
  enabled = true,
}: {
  origin: "all" | HomeworkOrigin;
  filter: LibraryFilter;
  enabled?: boolean;
}) {
  return useInfiniteQuery({
    queryKey: [...HOMEWORK_KEY, "library", origin, filter],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<Homework[]> => {
      const { data, error } = await libraryRead(LIBRARY_COLUMNS, origin, filter)
        .order("due_at", { ascending: true })
        .order("id", { ascending: true })
        .range(pageParam, pageParam + LIBRARY_PAGE - 1);
      if (error) throw error;
      return (data ?? []) as unknown as Homework[];
    },
    getNextPageParam: (last, pages) =>
      last.length < LIBRARY_PAGE ? undefined : pages.length * LIBRARY_PAGE,
    // The list stays on screen while the next filter's rows land.
    placeholderData: (prev) => prev,
    enabled,
  });
}

const LIBRARY_COLUMNS =
  "id, title, instructions, subject, board, level, due_at, created_at, origin";

/**
 * The library's briefs, narrowed by the tutor's filters. A topic is reached
 * through the brief's spec point, so only that filter joins; a brief with no
 * spec point (one a tutor wrote from scratch) still answers to the others. The
 * join names its key: `resource_spec_points` links the two tables as well.
 */
function libraryRead(
  columns: string,
  origin: "all" | HomeworkOrigin,
  filter: LibraryFilter,
  head = false,
) {
  let q = supabase
    .from("resources")
    .select(
      filter.topicId
        ? `${columns}, spec_points!resources_spec_point_id_fkey!inner(topic_id)`
        : columns,
      {
        count: head ? "exact" : undefined,
        head,
      },
    )
    .eq("kind", "homework");
  if (origin !== "all") q = q.eq("origin", origin);
  if (filter.subject) q = q.eq("subject", filter.subject);
  const course = courseParts(filter.course);
  if (course) q = q.eq("board", course.board).eq("level", course.level);
  if (filter.topicId) q = q.eq("spec_points.topic_id", filter.topicId);
  const pattern = ilikePattern(filter.q);
  if (pattern) q = q.ilike("title", pattern);
  return q;
}

/** How many briefs match the filters, by who wrote them, counted on the server. */
export function useHomeworkLibraryCounts({
  filter,
  enabled = true,
}: {
  filter: LibraryFilter;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [...HOMEWORK_KEY, "library-counts", filter],
    queryFn: async (): Promise<Record<"all" | HomeworkOrigin, number>> => {
      const count = async (origin: "all" | HomeworkOrigin) => {
        const { count, error } = await libraryRead("id", origin, filter, true);
        if (error) throw error;
        return count ?? 0;
      };
      const [all, tutor, generated] = await Promise.all([
        count("all"),
        count("tutor"),
        count("generated"),
      ]);
      return { all, tutor, generated };
    },
    // The chips keep their numbers while the next filter's land.
    placeholderData: (prev) => prev,
    enabled,
  });
}

/** This student's submissions, keyed by the homework they answer. */
export function useHomeworkSubmissions({
  userId,
  enabled = true,
}: {
  userId: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [...HOMEWORK_KEY, "submissions", userId],
    queryFn: async (): Promise<Record<string, SubmissionRow>> => {
      if (isDemoStudent()) return DEMO_SUBMISSIONS;
      if (!userId) return {};

      // Named columns rather than `*`: the row also carries the review window's
      // bookkeeping, and a student has no business fetching it.
      const { data, error } = await supabase
        .from("homework_submissions")
        .select(
          "id, resource_id, student_id, notes, submitted_at, score_pct, feedback, graded_at, acknowledged_at, release_at",
        )
        .eq("student_id", userId);
      if (error) throw error;

      const map: Record<string, SubmissionRow> = {};
      for (const s of data ?? []) map[s.resource_id] = s as SubmissionRow;
      return map;
    },
    enabled: enabled && (isDemoStudent() || !!userId),
  });
}

/**
 * Everything one homework sheet needs, for the page that opens it.
 *
 * The list deliberately doesn't fetch question text — see `useHomeworkSummaries`
 * — so this is where the prompts, the student's answers and the marks are
 * actually loaded, one sheet at a time. Mark schemes come with them, but the
 * page only shows them once the work has been marked.
 */
export function useHomeworkSheet({
  homeworkId,
  userId,
  enabled = true,
}: {
  homeworkId: string;
  userId: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [...HOMEWORK_KEY, "sheet", homeworkId, userId],
    queryFn: async (): Promise<{
      hw: Homework;
      questions: HomeworkQuestion[];
      submission: SubmissionRow | null;
      answers: Record<string, HomeworkAnswer>;
    }> => {
      if (isDemoStudent()) return demoSheet(homeworkId);

      const [hwRes, qRes] = await Promise.all([
        supabase
          .from("resources")
          .select("id, title, instructions, subject, board, level, due_at, created_at, origin")
          .eq("id", homeworkId)
          .eq("kind", "homework")
          .maybeSingle(),
        supabase
          .from("homework_questions")
          .select(QUESTION_COLUMNS)
          .eq("resource_id", homeworkId)
          .order("position", { ascending: true }),
      ]);
      if (hwRes.error) throw hwRes.error;
      if (!hwRes.data) throw new Error("That task doesn't exist, or isn't yours to open");
      if (qRes.error) throw qRes.error;
      // Released only to a tutor, or once this student's work is marked.
      const questions = await withMarkSchemes(qRes.data ?? []);

      // A tutor previewing the sheet has no submission of their own, and
      // shouldn't inherit anyone else's.
      let submission: SubmissionRow | null = null;
      let answers: Record<string, HomeworkAnswer> = {};
      if (userId) {
        // These two reads must fail loudly. "No submission" is what draws the
        // blank answer form, so a dropped request used to show a student an
        // empty sheet for homework they had already handed in — and invite them
        // to write it all out again.
        const { data: sub, error: subError } = await supabase
          .from("homework_submissions")
          .select(
            "id, resource_id, student_id, notes, submitted_at, score_pct, feedback, graded_at, acknowledged_at, release_at",
          )
          .eq("resource_id", homeworkId)
          .eq("student_id", userId)
          .maybeSingle();
        if (subError) throw subError;
        submission = (sub as SubmissionRow | null) ?? null;

        if (submission) {
          const { data: rows, error: answersError } = await supabase
            .from("homework_answers")
            .select("id, submission_id, question_id, answer_text, awarded_marks, feedback")
            .eq("submission_id", submission.id);
          if (answersError) throw answersError;
          answers = Object.fromEntries(
            (rows ?? []).map((a) => [a.question_id, a as HomeworkAnswer]),
          );
        }
      }

      return {
        hw: hwRes.data as Homework,
        questions: questions as HomeworkQuestion[],
        submission,
        answers,
      };
    },
    enabled: enabled && !!homeworkId,
    // Handed in and not yet marked: the mark lands within minutes, and the
    // student is sitting on this page waiting for it. Check for them, rather
    // than asking them to keep refreshing. Stops as soon as the mark arrives.
    refetchInterval: (query) => {
      const submission = query.state.data?.submission;
      return submission && !submission.graded_at && !isDemoStudent()
        ? AWAITING_MARK_POLL_MS
        : false;
    },
  });
}

/** Refetches briefs and submissions together — use after submitting or acknowledging. */
export function useInvalidateHomework() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: HOMEWORK_KEY });
  }, [queryClient]);
}

/** One sheet assembled from the showcase fixtures, in the shape the page expects. */
function demoSheet(homeworkId: string) {
  const hw = DEMO_HOMEWORK.find((h) => h.id === homeworkId);
  if (!hw) throw new Error("That task doesn't exist, or isn't yours to open");

  const submission = DEMO_SUBMISSIONS[homeworkId] ?? null;
  const answers = submission
    ? Object.fromEntries(
        Object.values(DEMO_ANSWERS)
          .filter((a) => a.submission_id === submission.id)
          .map((a) => [a.question_id, a]),
      )
    : {};

  return {
    hw: demoHomework(hw),
    questions: DEMO_QUESTIONS[homeworkId] ?? [],
    submission: submission as SubmissionRow | null,
    answers,
  };
}

/** A showcase fixture in the shape of a real brief: every board, the demo's level. */
function demoHomework(hw: (typeof DEMO_HOMEWORK)[number]): Homework {
  return { ...hw, board: null, level: DEMO_LEVEL };
}
