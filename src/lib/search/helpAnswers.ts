import {
  BookMarked,
  CalendarClock,
  ClipboardList,
  Coffee,
  Compass,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  PlayCircle,
  Settings,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSessionUserId } from "@/lib/auth/session";
import { SUBJECTS, type SubjectV } from "@/lib/curriculum/taxonomy";
import { WeeklyPlanDAL, type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { WeeklyActivityDAL } from "@/lib/planner/weeklyActivityDal";
import { weeksToExam } from "@/lib/planner/pacing";
import { PLANNER_TIME_ZONE, currentWeekKey } from "@/lib/planner/week";
import { weakestPoints } from "@/lib/chat/questionIdeas";
import { recentMarks } from "@/lib/chat/recentMarks";
import { curriculumTarget, isVisible, runGlobalSearch, type SearchSection } from "./globalSearch";
import { helpIntent, type HelpIntentId } from "./help";
import type { SearchContext, SearchHit } from "./types";
import { liveWindowStart } from "@/lib/live/liveSessions";

/**
 * The answer to a help intent: the student's own quizzes, tasks and sessions
 * where the intent is about them, and the page to go to where it isn't.
 *
 * Every read is the signed-in student's, through RLS, the same reads the
 * planner and the Live Sessions page make — so the box can never point at
 * something those pages wouldn't show.
 */

/** Items listed before the "see all" page, so one busy week can't fill the box. */
const ITEM_LIMIT = 6;

const subjectLabel = (s: string) => SUBJECTS.find((x) => x.value === s)?.label ?? s;

/** "Thu 9 Oct" — or with the time, "Thu 9 Oct, 17:00". */
function when(iso: string, withTime: boolean): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: PLANNER_TIME_ZONE,
  });
}

function page(
  to: string,
  title: string,
  icon: SearchHit["icon"],
  search?: Record<string, string>,
): SearchHit {
  return { key: `help:page:${to}:${title}`, group: "help", title, icon, to, search, score: 0 };
}

const PLANNER = (title = "This week's plan") => page("/planner", title, Compass, { tab: "week" });

type WeekPoint = PlanPoint & { subject: SubjectV };

/**
 * This week's plan across every subject the student takes, and the work
 * attached to each point. A subject with no plan yet simply adds nothing — the
 * planner writes the week the first time it is opened.
 */
async function thisWeek(ctx: SearchContext) {
  const uid = await getSessionUserId();
  if (!uid) return { points: [] as WeekPoint[], activity: new Map() };
  const week = currentWeekKey();
  const plans = await Promise.all(
    ctx.entitledSubjects.map((s) => WeeklyPlanDAL.getPlan(uid, s, week).catch(() => null)),
  );
  const points: WeekPoint[] = plans.flatMap((p, i) =>
    p ? p.points.map((pt) => ({ ...pt, subject: ctx.entitledSubjects[i] })) : [],
  );
  // Unfinished first: what's left to do is what a student is looking for.
  points.sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at));
  const activity = await WeeklyActivityDAL.getActivity(points.map((p) => p.spec_point_id));
  return { points, activity };
}

async function weekQuizzes(ctx: SearchContext): Promise<SearchHit[]> {
  const { points, activity } = await thisWeek(ctx);
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const point of points) {
    for (const quiz of activity.get(point.spec_point_id)?.quizzes ?? []) {
      if (seen.has(quiz.id)) continue;
      seen.add(quiz.id);
      hits.push({
        key: `help:quiz:${quiz.id}`,
        group: "help",
        title: quiz.title,
        code: point.code,
        tags: [subjectLabel(point.subject)],
        icon: ListChecks,
        score: 0,
        to: "/mcq/$setId",
        params: { setId: quiz.id },
      });
    }
  }
  return [
    ...hits.slice(0, ITEM_LIMIT),
    hits.length ? page("/mcqs", "All your MCQs", ListChecks) : PLANNER(),
  ];
}

async function weekTasks(ctx: SearchContext): Promise<SearchHit[]> {
  const { points, activity } = await thisWeek(ctx);
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const point of points) {
    for (const task of activity.get(point.spec_point_id)?.homework ?? []) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      hits.push({
        key: `help:task:${task.id}`,
        group: "help",
        title: task.title,
        code: task.dueAt ? `Due ${when(task.dueAt, false)}` : point.code,
        tags: [subjectLabel(point.subject)],
        icon: ClipboardList,
        score: 0,
        to: `/homework/${task.id}`,
      });
    }
  }
  return [
    ...hits.slice(0, ITEM_LIMIT),
    hits.length ? page("/homework", "All your tasks", ClipboardList) : PLANNER(),
  ];
}

/** Sessions still to come, or running now (so still joinable). */
async function nextLive(ctx: SearchContext): Promise<SearchHit[]> {
  const since = liveWindowStart(Date.now());
  const { data, error } = await supabase
    .from("resources")
    .select("id, title, subject, board, level, starts_at")
    .eq("kind", "live_session")
    .gte("starts_at", since)
    .order("starts_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  const hits: SearchHit[] = (data ?? [])
    .filter((row) => row.starts_at && isVisible(ctx, row))
    .slice(0, ITEM_LIMIT)
    .map((row) => ({
      key: `help:live:${row.id}`,
      group: "help",
      title: row.title,
      code: when(row.starts_at!, true),
      tags: [subjectLabel(row.subject)],
      icon: CalendarClock,
      score: 0,
      to: "/live",
    }));
  return [...hits, page("/live", "All live sessions", CalendarClock)];
}

type PointRow = {
  id: string;
  code: string;
  title: string;
  topics: { subject: string; board: string; level: string };
};

/** The topics the student's newest marks are lowest on, worst first. */
async function weakTopics(ctx: SearchContext): Promise<SearchHit[]> {
  const uid = await getSessionUserId();
  const ids = uid ? weakestPoints(await recentMarks(supabase, uid), ITEM_LIMIT) : [];
  if (ids.length === 0) return [PLANNER("Nothing to fix yet: carry on with this week")];
  const { data, error } = await supabase
    .from("spec_points")
    .select("id, code, title, topics!inner(subject, board, level)")
    .in("id", ids);
  if (error) throw error;
  const rows = (data ?? []) as unknown as PointRow[];
  const hits = ids.flatMap((id): SearchHit[] => {
    const row = rows.find((r) => r.id === id);
    if (!row || !isVisible(ctx, row.topics)) return [];
    return [
      {
        key: `help:weak:${row.id}`,
        group: "help",
        title: row.title,
        code: row.code,
        tags: [subjectLabel(row.topics.subject)],
        icon: Target,
        score: 0,
        ...curriculumTarget({ ...row.topics, pointId: row.id }, false),
      },
    ];
  });
  return hits.length ? hits : [PLANNER("Nothing to fix yet: carry on with this week")];
}

/** Each subject's exam date and how far off it is. */
async function examDates(ctx: SearchContext): Promise<SearchHit[]> {
  const uid = await getSessionUserId();
  if (!uid) return [PLANNER()];
  const { data, error } = await supabase
    .from("student_program_plan")
    .select("subject, exam_date")
    .eq("student_id", uid);
  if (error) throw error;
  const hits = (data ?? [])
    .filter((p) => ctx.entitledSubjects.includes(p.subject))
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))
    .flatMap((p): SearchHit[] => {
      const at = Date.parse(`${p.exam_date}T00:00:00Z`);
      if (!Number.isFinite(at)) return [];
      const weeks = weeksToExam(p.exam_date);
      const day = new Date(at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      return [
        {
          key: `help:exam:${p.subject}`,
          group: "help",
          title: `${subjectLabel(p.subject)} exams: ${day}`,
          code: weeks > 0 ? `${weeks} ${weeks === 1 ? "week" : "weeks"}` : null,
          icon: GraduationCap,
          score: 0,
          to: "/planner",
        },
      ];
    });
  return hits.length ? hits : [PLANNER()];
}

/** Points listed for a practice request, so the answer stays a glance. */
const PRACTICE_LIMIT = 4;

/**
 * Practice on a topic: the quiz each matching point already has, or the point
 * itself, where its MCQs and task can be requested.
 */
async function practice(ctx: SearchContext, terms: string[]): Promise<SearchHit[]> {
  const all = [page("/mcqs", "All your MCQs", ListChecks), PLANNER()];
  if (terms.length === 0) return all;
  const found = await runGlobalSearch(terms.join(" "), ctx);
  const points = (found.find((s) => s.group === "spec_point")?.hits ?? []).slice(0, PRACTICE_LIMIT);
  if (points.length === 0) return all;
  const idOf = (hit: SearchHit) => hit.search?.point ?? "";
  const { data, error } = await supabase
    .from("mcq_sets")
    .select("id, title, spec_point_id")
    .eq("published", true)
    .in("spec_point_id", points.map(idOf));
  if (error) throw error;
  return points.map((point): SearchHit => {
    const quiz = (data ?? []).find((q) => q.spec_point_id === idOf(point));
    return quiz
      ? {
          key: `help:practice:${quiz.id}`,
          group: "help",
          title: quiz.title,
          code: point.code,
          tags: point.tags,
          icon: ListChecks,
          score: 0,
          to: "/mcq/$setId",
          params: { setId: quiz.id },
        }
      : {
          ...point,
          key: `help:practice:${idOf(point)}`,
          group: "help",
          title: `Request MCQs and a task: ${point.title}`,
          subtitle: null,
          icon: Sparkles,
          score: 0,
        };
  });
}

type FoundNote = { conceptId: string; title: string };

/**
 * The published note that best covers a topic, for a science question. Every
 * word of the topic has to match, so when "moles CO₂" finds nothing its words
 * are tried on their own, longest first.
 */
export async function findNote(topic: string, ctx: SearchContext): Promise<FoundNote | null> {
  const words = topic.split(/\s+/).filter(Boolean);
  const alone = words.length > 1 ? [...words].sort((a, b) => b.length - a.length) : [];
  for (const attempt of [topic, ...alone]) {
    const note = await noteFor(attempt, ctx);
    if (note) return note;
  }
  return null;
}

async function noteFor(topic: string, ctx: SearchContext): Promise<FoundNote | null> {
  const found = await runGlobalSearch(topic, ctx);
  const note = found.find((s) => s.group === "note")?.hits[0];
  if (note?.params?.conceptId) return { conceptId: note.params.conceptId, title: note.title };

  // No note is named after it: take the note written for the best-matching point.
  const ids = (found.find((s) => s.group === "spec_point")?.hits ?? [])
    .slice(0, PRACTICE_LIMIT)
    .map((h) => h.search?.point ?? "")
    .filter(Boolean);
  if (ids.length === 0) return null;
  const { data: links, error } = await supabase
    .from("note_concept_spec_points")
    .select("spec_point_id, is_primary, note_concepts(id, title)")
    .in("spec_point_id", ids);
  if (error) throw error;
  const concepts = (links ?? []).flatMap((l) => (l.note_concepts ? [l.note_concepts.id] : []));
  if (concepts.length === 0) return null;
  const { data: live, error: liveError } = await supabase
    .from("notes")
    .select("concept_id")
    .eq("status", "approved")
    .in("concept_id", concepts);
  if (liveError) throw liveError;
  const published = new Set((live ?? []).map((n) => n.concept_id));
  const ranked = (links ?? [])
    .filter((l) => l.note_concepts && published.has(l.note_concepts.id))
    .sort(
      (a, b) =>
        ids.indexOf(a.spec_point_id) - ids.indexOf(b.spec_point_id) ||
        Number(b.is_primary) - Number(a.is_primary),
    );
  const best = ranked[0]?.note_concepts;
  return best ? { conceptId: best.id, title: best.title } : null;
}

/**
 * A science answer as the top section of the box: the model's words (when the
 * note covered the question), the note they came from, and the team for
 * anything it left unanswered.
 */
export function explainSection(
  note: { conceptId: string; title: string },
  answer: string | null,
): SearchSection {
  const hits: SearchHit[] = [
    {
      key: `help:note:${note.conceptId}`,
      group: "help",
      title: `Read the note: ${note.title}`,
      icon: BookMarked,
      score: 0,
      to: "/notes/$conceptId",
      params: { conceptId: note.conceptId },
    },
    page("/messages", "Still stuck? Ask the team", MessagesSquare),
  ];
  return {
    group: "help",
    label: answer ? "AI answer from our notes" : "Our note on this",
    answer: answer ?? undefined,
    hits,
    total: hits.length,
  };
}

async function hitsFor(
  intent: HelpIntentId,
  ctx: SearchContext,
  terms: string[],
): Promise<SearchHit[]> {
  switch (intent) {
    case "weak_topics":
      return weakTopics(ctx);
    case "practice":
      return practice(ctx, terms);
    case "exam_date":
      return examDates(ctx);
    case "break":
      return [page("/billing", "Take a break: at the top of Billing", Coffee)];
    case "week_quizzes":
      return weekQuizzes(ctx);
    case "week_tasks":
      return weekTasks(ctx);
    case "next_live":
      return nextLive(ctx);
    case "week_videos":
      return [PLANNER("Watch them in this week's plan"), page("/videos", "All videos", PlayCircle)];
    case "week_plan":
      return [PLANNER()];
    case "grades":
      return [
        page("/homework", "Tasks & Grades", ClipboardList),
        page("/student-dashboard", "Your target and working-towards grades", LayoutDashboard),
      ];
    case "notes":
      return [page("/curriculum", "Revision notes are on each spec point", BookMarked)];
    case "messages":
      return [page("/messages", "Message your tutor", MessagesSquare)];
    case "billing":
      return [page("/billing", "Billing", CreditCard)];
    case "account":
      return [page("/profile", "Profile", UserRound), page("/settings", "Settings", Settings)];
  }
}

/**
 * Where to send the student when their own data couldn't be read: the page
 * that lists it. A failed read must not hide the content search beneath.
 */
function fallback(intent: HelpIntentId): SearchHit[] {
  if (intent === "week_quizzes") return [page("/mcqs", "All your MCQs", ListChecks), PLANNER()];
  if (intent === "week_tasks")
    return [page("/homework", "All your tasks", ClipboardList), PLANNER()];
  if (intent === "practice") return [page("/mcqs", "All your MCQs", ListChecks), PLANNER()];
  if (intent === "weak_topics" || intent === "exam_date") return [PLANNER()];
  return [page("/live", "All live sessions", CalendarClock)];
}

/** The help answer as one section of the search box, headed by what was understood. */
export async function helpSection(
  intent: HelpIntentId,
  ctx: SearchContext,
  terms: string[] = [],
): Promise<SearchSection> {
  const hits = await hitsFor(intent, ctx, terms).catch(() => fallback(intent));
  return { group: "help", label: helpIntent(intent).label, hits, total: hits.length };
}
