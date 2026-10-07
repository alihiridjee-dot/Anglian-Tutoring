import "@tanstack/react-start/server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseFetch, scopeSupabase, supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { BoardV, LevelV, SubjectV } from "@/lib/curriculum/taxonomy";
import { MIN_SECRET_LENGTH, sameSecret } from "@/lib/practice/practiceQueue.server";
import { ProgramDAL } from "./programDal";
import { WeeklyPlanDAL } from "./weeklyPlanDal";
import { SubjectPauseDAL } from "./pausesDal";
import { BreakDAL } from "./breaksDal";
import { breakCovering } from "./breaks";
import { customSchedule } from "./topicOrder";
import { weekIsForAnotherCourse } from "./weekCut";
import { currentWeekKey } from "./week";

// The nightly plan check. Every saved week for this week is checked against
// its student's full plan, and one that has fallen behind is re-cut, so a
// week is put right even when its student doesn't log in. The page-open check
// in useWeekPlan does the same thing when the student looks; this is the
// sweep for everyone else. pg_cron calls `POST /api/plan-heal` once a night,
// with the secret it uses for the practice worker.
//
// It runs the app's own plan code, the code a student's page runs, so there
// is one set of rules. It reads and writes with the server's service key,
// which sees what a tutor sees; a tutor's own changes already re-cut a
// student's week through this same code. The database still decides what may
// be saved: no planning a stopped subject or a break week, nothing past the
// exam, nothing a tutor set aside. A dry run reports what it would change and
// saves nothing.

type ServiceClient = ReturnType<typeof createClient<Database>>;

const runs = new AsyncLocalStorage<ServiceClient>();
scopeSupabase(() => runs.getStore());

/** Run `work` with every `supabase` call in it, and only in it, going through `client`. */
export function withClient<T>(client: ServiceClient, work: () => Promise<T>): Promise<T> {
  return runs.run(client, work);
}

/** The server's service key, with no session to keep or refresh. */
function serviceClient(): ServiceClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("The plan check needs the server Supabase service credential");
  return createClient<Database>(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** What the check found for one student's subject this week. */
export type CheckOutcome =
  /** The week teaches what the full plan gives it. */
  | "in-step"
  /** It didn't, and was re-cut. */
  | "healed"
  /** Dry run: it would be re-cut. */
  | "would-heal"
  /** The re-cut found nothing to change once the week's work was counted. */
  | "unchanged"
  /** The full plan had a re-flow waiting: applied as the planner does on sight, this week included. */
  | "plan-applied"
  /** Dry run: that re-flow would be applied. */
  | "would-apply"
  /** Left for the student's own visit; `reason` says why. */
  | "left"
  | "failed";

export interface CourseCheck {
  studentId: string;
  subject: string;
  outcome: CheckOutcome;
  reason?: string;
  /** Points the plan teaches this week that the week lacked. */
  missing?: number;
  /** Untouched points the plan now teaches in a later week. */
  stale?: number;
  error?: string;
}

export interface CheckRun {
  week: string;
  dryRun: boolean;
  courses: CourseCheck[];
  /** Saved weeks this run had no time left for. */
  unreached: number;
}

/** A saved week, as the run lists them. */
export interface SavedWeekRow {
  student_id: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
}

/** The course the student is on now: the enrolment's board and the profile's level. */
async function currentCourse(
  studentId: string,
  subject: SubjectV,
): Promise<{ board: BoardV; level: LevelV } | null> {
  const [enrolment, profile] = await Promise.all([
    supabase
      .from("student_enrolments")
      .select("board")
      .eq("student_id", studentId)
      .eq("subject", subject)
      .maybeSingle(),
    supabase.from("profiles").select("level").eq("id", studentId).maybeSingle(),
  ]);
  const error = enrolment.error ?? profile.error;
  if (error) throw new Error(error.message);
  return enrolment.data && profile.data?.level
    ? { board: enrolment.data.board, level: profile.data.level }
    : null;
}

/**
 * Check one saved week and, unless this is a dry run, put it right. Never
 * throws: a failure is reported as one and the run moves on.
 *
 * It stops where a student's own visit would stop (useWeekPlan): a subject
 * that is stopped and a break week are read, never planned. It also leaves
 * what only a visit should do: a finished pause waiting to be picked up, a
 * changed course, a plan never set up, and a custom topic order's re-flow
 * (that goes through `reorder_student_topics`, which needs the student or a
 * tutor signed in).
 */
export async function checkCourse(
  week: SavedWeekRow & { week_start: string },
  dryRun: boolean,
  readCourse: typeof currentCourse = currentCourse,
): Promise<CourseCheck> {
  const studentId = week.student_id;
  const subject = week.subject;
  const weekStart = week.week_start;
  const found = { studentId, subject };
  const left = (reason: string): CourseCheck => ({ ...found, outcome: "left", reason });
  try {
    if (await SubjectPauseDAL.open(studentId, subject)) return left("subject stopped");
    if (breakCovering(await BreakDAL.list(studentId), weekStart)) return left("break week");
    // Picking the plan up after a pause saves it, so it waits for a visit:
    // this keeps a dry run read-only, and never checks a week against the
    // plan from before the pause.
    const stops = await SubjectPauseDAL.history(studentId, subject);
    if (stops.some((s) => s.endedAt && !s.programmeResumedAt)) return left("pause to pick up");
    const course = await readCourse(studentId, subject);
    if (!course) return left("no course");
    if (weekIsForAnotherCourse(week, course)) return left("course changed");

    const params = { studentId, subject, ...course };
    const roadmap = await ProgramDAL.loadRoadmap(params);
    // No plan saved yet, or one for the old course: the student's first look sets it.
    if (!roadmap?.storedBands) return left("no full plan");
    if (roadmap.needsAck) {
      if (customSchedule(roadmap.storedBands)) return left("custom order to re-flow");
      if (dryRun) return { ...found, outcome: "would-apply" };
      await ProgramDAL.applyPending(params);
      return { ...found, outcome: "plan-applied" };
    }

    const saved = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
    if (!saved) return left("no week");
    const drift = await ProgramDAL.weekBehindPlan({ studentId, weekStart, saved, roadmap });
    if (!drift) return { ...found, outcome: "in-step" };
    const counts = { missing: drift.missing.length, stale: drift.stale.length };
    if (dryRun) return { ...found, outcome: "would-heal", ...counts };
    const changed = await ProgramDAL.refreshWeek({ ...params, weekStart });
    return { ...found, outcome: changed ? "healed" : "unchanged", ...counts };
  } catch (e) {
    return { ...found, outcome: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Every week saved for `week`, a page at a time (PostgREST returns at most 1,000 rows). */
async function savedWeeks(week: string): Promise<SavedWeekRow[]> {
  const rows: SavedWeekRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("student_weekly_plans")
      .select("student_id, subject, board, level")
      .eq("week_start", week)
      .order("student_id")
      .order("subject")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

/**
 * Check every week saved for this week, in student order, until the
 * deadline. Each run is recorded (`private.plan_heal_runs`), dry runs too.
 */
export async function checkThisWeek(opts: {
  dryRun: boolean;
  /** Stop starting new checks after this time (ms since the epoch). */
  deadline?: number;
  now?: Date;
}): Promise<CheckRun> {
  const week = currentWeekKey(opts.now);
  return withClient(serviceClient(), async () => {
    const courses: CourseCheck[] = [];
    let unreached = 0;
    for (const row of await savedWeeks(week)) {
      if (opts.deadline && Date.now() > opts.deadline) unreached++;
      else courses.push(await checkCourse({ ...row, week_start: week }, opts.dryRun));
    }
    const run: CheckRun = { week, dryRun: opts.dryRun, courses, unreached };
    const { error } = await supabase.rpc(
      "record_plan_heal_run" as never,
      { _week_start: week, _dry_run: opts.dryRun, _report: run } as never,
    );
    if (error) console.warn("[plan-heal] couldn't record the run", error.message);
    return run;
  });
}

/** How many courses ended each way: what the logs say, with no student in it. */
export function tally(run: CheckRun): Record<string, number> {
  const counts: Record<string, number> = { unreached: run.unreached };
  for (const c of run.courses) counts[c.outcome] = (counts[c.outcome] ?? 0) + 1;
  return counts;
}

/** Vercel stops the function at 300 s; a run starts no new check after this. */
const RUN_BUDGET_MS = 240_000;

/**
 * `POST /api/plan-heal`, which pg_cron calls once a night with
 * `Authorization: Bearer <PRACTICE_WORKER_SECRET>` and `{"dryRun": true}` for
 * a dry run. Always answers JSON, failures included.
 */
export async function handlePlanHealRequest(request: Request): Promise<Response> {
  if (request.method !== "POST")
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  const secret = process.env.PRACTICE_WORKER_SECRET?.trim();
  // Fails closed: without a proper secret, nobody can start a run.
  if (!secret || secret.length < MIN_SECRET_LENGTH)
    return Response.json({ error: "The plan check is not configured" }, { status: 503 });
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { dryRun?: unknown } | null;
  try {
    const run = await checkThisWeek({
      dryRun: body?.dryRun === true,
      deadline: Date.now() + RUN_BUDGET_MS,
    });
    console.info(`[plan-heal] ${run.week}${run.dryRun ? " (dry run)" : ""}`, tally(run));
    return Response.json(run);
  } catch (error) {
    console.error("[plan-heal] the check failed", error);
    const message = error instanceof Error ? error.message : "The plan check failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
