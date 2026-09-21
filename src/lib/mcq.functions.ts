import { createServerFn } from "@tanstack/react-start";
import {
  generateExamQuestions,
  libraryRequest,
  loadGenerationContext,
} from "./examGeneration.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SUBJECTS } from "@/lib/taxonomy";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// MCQs are library content, the way homework is: each spec point has one shared
// set, written once — grounded in real past-paper questions — and reused by every
// student and every quiz after that. Nothing here pays for a point that already
// has its set.
//
//   - ensureMcqForPoints     — the planner fills in a week's missing sets.
//   - generateMcqSet         — a tutor's "generate" button on one spec point.
//   - generateCurriculumQuiz — a tutor-assigned quiz with a due date, built by
//                              copying the shared questions for its points.
//   - generateWeeklyQuiz     — the same, for the points a live session covers.

/** Questions in each spec point's shared set. */
const QUESTIONS_PER_POINT = 8;

/**
 * Sets one student may cause to be written per hour, counted in the database
 * (`claim_ai_request`). A spend cap, not a correctness guard — the unique index
 * behind `ensure_generated_mcq_set` is what stops two students paying twice.
 */
const GENERATIONS_PER_HOUR = 12;

type SupabaseServer = SupabaseClient<Database>;

async function requireTutor(supabase: SupabaseServer, userId: string) {
  const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((role ?? []) as Array<{ role: string }>).map((r) => r.role);
  if (!roles.includes("tutor") && !roles.includes("admin")) {
    throw new Error("Tutor access required");
  }
}

/**
 * The shared set for a point, or null. Asked of the database rather than read
 * through RLS, so a set a tutor has unpublished still counts as existing and is
 * not paid for again.
 */
async function findSharedSet(pointId: string, userId: string): Promise<string | null> {
  const id = await libraryRequest("rpc/ensure_generated_mcq_set", {
    _spec_point_id: pointId,
    _questions: null,
    _created_by: userId,
  });
  return typeof id === "string" ? id : null;
}

interface SharedSets {
  /** Spec point id → its shared set id, for every point that has one. */
  sets: Map<string, string>;
  /** Sets written by this call. */
  created: number;
  /** True when the hourly budget ran out before every gap was filled. */
  throttled: boolean;
}

/**
 * Make sure every point has its shared set, writing only the missing ones.
 *
 * `throttle` applies the per-student spend cap (the planner path); `soft` logs a
 * failed point and carries on rather than failing the whole call, because a week
 * missing one quiz chip is better than a week that won't render.
 */
async function ensureSharedSets(
  supabase: SupabaseServer,
  userId: string,
  pointIds: string[],
  { throttle, soft }: { throttle: boolean; soft: boolean },
): Promise<SharedSets> {
  const sets = new Map<string, string>();
  const found = await Promise.all(pointIds.map((id) => findSharedSet(id, userId)));
  pointIds.forEach((id, i) => found[i] && sets.set(id, found[i]!));

  // Budget is claimed up front, one point at a time, so a batch that runs out
  // still writes whatever it was allowed.
  const toWrite: string[] = [];
  let throttled = false;
  for (const pointId of pointIds.filter((id) => !sets.has(id))) {
    if (throttle) {
      const { data: allowed, error: limitErr } = await supabase.rpc("claim_ai_request", {
        _endpoint: "mcq_generation",
        _limit: GENERATIONS_PER_HOUR,
        _window: "01:00:00",
      });
      if (limitErr || !allowed) {
        throttled = true;
        break;
      }
    }
    toWrite.push(pointId);
  }

  // A set takes about a minute to write, so points run side by side; one after
  // another, a quiz over several new points would outlast the request.
  let created = 0;
  const write = async (pointId: string) => {
    try {
      // Reads the point as the caller first, so nobody generates for a point
      // they cannot see.
      const context = await loadGenerationContext(supabase, pointId);
      const questions = await generateExamQuestions(context, QUESTIONS_PER_POINT, "mcq");
      const setId = await libraryRequest("rpc/ensure_generated_mcq_set", {
        _spec_point_id: pointId,
        _questions: questions.map((q) => ({
          question: q.question.trim(),
          options: q.options.map((o) => o.trim()),
          correct_index: q.correct_index,
          explanation: q.explanation.trim(),
        })),
        _created_by: userId,
      });
      if (typeof setId !== "string") throw new Error("The quiz could not be saved");
      sets.set(pointId, setId);
      created++;
    } catch (err) {
      if (!soft) throw err;
      console.error(`[mcq] generation failed for spec point ${pointId}:`, err);
    }
  };
  // allSettled first, so a hard failure still lets the other sets finish saving
  // (they are paid for either way) before the error is raised.
  const results = await Promise.allSettled(toWrite.map(write));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;

  return { sets, created, throttled };
}

/** Copy the shared questions for `pointIds`, in order, into a tutor quiz. */
async function fillFromShared(
  supabase: SupabaseServer,
  setId: string,
  pointIds: string[],
): Promise<number> {
  const { data: copied, error } = await supabase.rpc("fill_mcq_set_from_shared", {
    _set_id: setId,
    _spec_point_ids: pointIds,
  });
  if (error) throw error;
  if (!copied) throw new Error("None of the chosen points has any questions yet");
  return copied;
}

// ISO-8601 week number, used to label the weekly quiz.
function isoWeek(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

type EnsureInput = { specPointIds: string[] };

export interface EnsureMcqResult {
  /** Sets written by this call. */
  created: number;
  /** Points that already had one — the cheap, normal case. */
  existing: number;
  /** True when the hourly budget ran out before every gap was filled. */
  throttled: boolean;
}

/**
 * Fill in the quizzes for a week's spec points, writing anything missing.
 *
 * The first student to reach a point pays for its set; everyone after reads the
 * same rows for free. Failures are soft — see `ensureSharedSets`.
 */
export const ensureMcqForPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EnsureInput) => {
    const ids = Array.isArray(input?.specPointIds)
      ? [...new Set(input.specPointIds.map(String).filter(Boolean))]
      : [];
    if (ids.length === 0) throw new Error("No spec points given");
    // A week is a handful of points; the cap stops a hand-rolled request asking
    // for the whole specification in one call.
    return { specPointIds: ids.slice(0, 12) };
  })
  .handler(async ({ data, context }): Promise<EnsureMcqResult> => {
    const { supabase, userId } = context;
    const result = await ensureSharedSets(supabase, userId, data.specPointIds, {
      throttle: true,
      soft: true,
    });
    return {
      created: result.created,
      existing: result.sets.size - result.created,
      throttled: result.throttled,
    };
  });

type GenInput = { specPointId: string };

/**
 * A tutor's "generate" on one spec point. Returns the point's shared set,
 * writing it only if it doesn't exist yet.
 */
export const generateMcqSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GenInput) => {
    if (!input?.specPointId) throw new Error("specPointId required");
    return { specPointId: String(input.specPointId) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTutor(supabase, userId);

    const result = await ensureSharedSets(supabase, userId, [data.specPointId], {
      throttle: false,
      soft: false,
    });
    return { setId: result.sets.get(data.specPointId)!, created: result.created > 0 };
  });

type CurriculumQuizInput = {
  subject: string;
  specPointIds: string[];
  title: string;
  dueAt: string;
};

// Tutor-assigned weekly quiz built from hand-picked curriculum points, with a due
// date — independent of any live session. It holds copies of each point's shared
// questions, tagged with their point so the set surfaces under every point a
// student browses. The non-null due_at is what marks it as an assigned weekly set
// on the student page.
export const generateCurriculumQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CurriculumQuizInput) => {
    const ids = Array.isArray(input?.specPointIds)
      ? [...new Set(input.specPointIds.map(String).filter(Boolean))]
      : [];
    if (ids.length === 0) throw new Error("Select at least one spec point");
    if (!input?.dueAt) throw new Error("Due date required");
    const subject = SUBJECTS.find((s) => s.value === input?.subject)?.value;
    if (!subject) throw new Error("subject required");
    return {
      subject,
      specPointIds: ids,
      title: String(input.title || "Weekly MCQs"),
      dueAt: String(input.dueAt),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTutor(supabase, userId);

    // Every point's set exists before the quiz row does, so a mid-way AI failure
    // can't leave a half-built published quiz.
    const { sets } = await ensureSharedSets(supabase, userId, data.specPointIds, {
      throttle: false,
      soft: false,
    });
    const points = data.specPointIds.filter((id) => sets.has(id));

    const { data: setRow, error: setErr } = await supabase
      .from("mcq_sets")
      .insert({
        resource_id: null,
        spec_point_id: null,
        title: data.title,
        description: `Weekly MCQs across ${points.length} spec point${
          points.length === 1 ? "" : "s"
        }`,
        published: true,
        subject: data.subject,
        week_number: isoWeek(data.dueAt),
        due_at: data.dueAt,
        created_by: userId,
      })
      .select("id")
      .single();
    if (setErr) throw setErr;

    try {
      const count = await fillFromShared(supabase, setRow.id, points);
      return { setId: setRow.id, count, points: points.length };
    } catch (err) {
      await supabase.from("mcq_sets").delete().eq("id", setRow.id);
      throw err;
    }
  });

type WeeklyInput = { resourceId: string };

export const generateWeeklyQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: WeeklyInput) => {
    if (!input?.resourceId) throw new Error("resourceId required");
    return { resourceId: String(input.resourceId) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTutor(supabase, userId);

    const { data: resource, error: resErr } = await supabase
      .from("resources")
      .select("id, title, subject, starts_at, kind")
      .eq("id", data.resourceId)
      .single();
    if (resErr || !resource) throw new Error("Session not found");
    if (resource.kind !== "live_session")
      throw new Error("Weekly quizzes are generated from live sessions");

    const { data: links, error: linkErr } = await supabase
      .from("resource_spec_points")
      .select("spec_point_id")
      .eq("resource_id", data.resourceId);
    if (linkErr) throw linkErr;

    const pointIds = [...new Set((links ?? []).map((l) => l.spec_point_id).filter(Boolean))];
    if (pointIds.length === 0) throw new Error("Tag at least one spec point on this session first");

    const { sets } = await ensureSharedSets(supabase, userId, pointIds, {
      throttle: false,
      soft: false,
    });
    const points = pointIds.filter((id) => sets.has(id));

    const title = `Weekly quiz — ${resource.title}`;
    const description = `Auto-generated from live session: ${resource.title}`;
    const week_number = isoWeek(resource.starts_at);

    // Idempotent per session: refresh the existing weekly set in place (keeps
    // any student attempts pointing at a live set) rather than duplicating.
    // Refreshing copies the shared questions again, so it costs nothing.
    const { data: existing } = await supabase
      .from("mcq_sets")
      .select("id")
      .eq("resource_id", data.resourceId)
      .maybeSingle();

    let setId: string;
    if (existing) {
      setId = existing.id;
      const { error: updErr } = await supabase
        .from("mcq_sets")
        .update({
          title,
          description,
          published: true,
          subject: resource.subject,
          week_number,
          spec_point_id: null,
        })
        .eq("id", setId);
      if (updErr) throw updErr;
    } else {
      const { data: setRow, error: setErr } = await supabase
        .from("mcq_sets")
        .insert({
          resource_id: data.resourceId,
          spec_point_id: null,
          title,
          description,
          published: true,
          subject: resource.subject,
          week_number,
          created_by: userId,
        })
        .select("id")
        .single();
      if (setErr) throw setErr;
      setId = setRow.id;
    }

    const count = await fillFromShared(supabase, setId, points);
    return { setId, count, points: points.length };
  });
