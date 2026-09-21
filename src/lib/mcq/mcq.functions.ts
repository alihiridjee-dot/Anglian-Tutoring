import { createServerFn } from "@tanstack/react-start";
import {
  generateExamQuestions,
  libraryRequest,
  loadGenerationContext,
} from "../homework/examGeneration.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// MCQs are library content, the way homework is: each spec point has one shared
// set, written once — grounded in real past-paper questions — and reused by every
// student after that. Nothing here pays for a point that already has its set.
//
//   - ensureMcqForPoints — the planner fills in a week's missing sets.
//   - generateMcqSet     — a tutor's "generate" button on one spec point.
//
// Tutors do not assign quizzes. A student's quizzes are the shared sets for the
// points in their own weekly plan, and nothing else.

/** Questions in each spec point's shared set. */
const QUESTIONS_PER_POINT = 8;

/**
 * Sets one student may cause to be written per hour, counted in the database
 * (`claim_ai_request`). A spend cap, not a correctness guard — the unique index
 * behind `ensure_generated_mcq_set` is what stops two students paying twice.
 */
const GENERATIONS_PER_HOUR = 12;

type SupabaseServer = SupabaseClient<Database>;

/**
 * Tutor only, matching every write policy on library content. Admin used to be
 * let through here too, and this path writes with the server's own credential —
 * so it was the one place an admin without the tutor role could write the
 * shared quiz every student reads, past the RLS that refuses them elsewhere.
 */
async function requireTutor(supabase: SupabaseServer, userId: string) {
  const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((role ?? []) as Array<{ role: string }>).map((r) => r.role);
  if (!roles.includes("tutor")) throw new Error("Tutor access required");
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
