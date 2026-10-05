import {
  BookMarked,
  CalendarClock,
  ClipboardList,
  Compass,
  CreditCard,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  PlayCircle,
  Settings,
  UserRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSessionUserId } from "@/lib/auth/session";
import { SUBJECTS, type SubjectV } from "@/lib/curriculum/taxonomy";
import { WeeklyPlanDAL, type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { WeeklyActivityDAL } from "@/lib/planner/weeklyActivityDal";
import { PLANNER_TIME_ZONE, currentWeekKey } from "@/lib/planner/week";
import { isVisible, type SearchSection } from "./globalSearch";
import { helpIntent, type HelpIntentId } from "./help";
import type { SearchContext, SearchHit } from "./types";

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

/** Sessions still to come, or started within the last hour (so still joinable). */
async function nextLive(ctx: SearchContext): Promise<SearchHit[]> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
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

async function hitsFor(intent: HelpIntentId, ctx: SearchContext): Promise<SearchHit[]> {
  switch (intent) {
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
  return [page("/live", "All live sessions", CalendarClock)];
}

/** The help answer as one section of the search box, headed by what was understood. */
export async function helpSection(
  intent: HelpIntentId,
  ctx: SearchContext,
): Promise<SearchSection> {
  const hits = await hitsFor(intent, ctx).catch(() => fallback(intent));
  return { group: "help", label: helpIntent(intent).label, hits, total: hits.length };
}
