import { createServerFn } from "@tanstack/react-start";
import {
  CALL_LIMITS,
  generateExamQuestions,
  libraryRequest,
  loadGenerationContext,
} from "../homework/examGeneration.server";
import { QUESTIONS, runPracticeJobNow } from "../practice/practiceQueue.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// MCQs are library content, the way homework is: each spec point has one shared
// set, written once — grounded in real past-paper questions — and reused by every
// student after that. The practice queue writes them: saving a week queues its
// points' missing sets, and the database hands out one job per point, so nothing
// pays for a set that exists or is already being written.
//
//   - generateMcqSet      — a tutor's "generate" button: that point's job, run now.
//   - replaceMcqQuestions — a tutor's "Replace questions" on a point's shared quiz.
//
// Tutors do not assign quizzes. A student's quizzes are the shared sets for the
// points in their own weekly plan, and nothing else.

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

type GenInput = { specPointId: string };

/**
 * A tutor's "generate" on one spec point. Runs that point's practice-queue job
 * now, under the same claim the queue's own worker takes, so it never pays for
 * a set that exists or is already being written. Returns the point's shared
 * set, or `queued` when the queue can't run the job this minute (paused,
 * already writing it, or at its limit) and will write the set when it can.
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

    const job = await runPracticeJobNow(data.specPointId, "quiz");
    return job.status === "completed"
      ? { setId: job.resultId, created: job.created, queued: false }
      : { setId: null, created: false, queued: true };
  });

type ReplaceInput = { setId: string };

/**
 * A tutor's "Replace questions" on a shared quiz: writes a fresh set of
 * questions for its spec point and swaps them in under the same set id.
 *
 * The way to fix a bad quiz. Deleting one that students have taken is refused
 * (it would erase their results), and generating again only finds the set that
 * is already there. Past attempts keep the score and per-point results they
 * were graded with.
 */
export const replaceMcqQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ReplaceInput) => {
    if (!input?.setId) throw new Error("setId required");
    return { setId: String(input.setId) };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireTutor(supabase, userId);

    // Read as the caller, so a tutor only replaces a set they can see.
    const { data: set, error } = await supabase
      .from("mcq_sets")
      .select("spec_point_id, origin")
      .eq("id", data.setId)
      .maybeSingle();
    if (error) throw error;
    if (!set?.spec_point_id || set.origin !== "generated")
      throw new Error("Only a spec point's shared quiz can have its questions replaced");

    const generation = await loadGenerationContext(supabase, set.spec_point_id);
    const { questions } = await generateExamQuestions(generation, QUESTIONS.quiz, "mcq", {
      ...CALL_LIMITS,
      source: "replace",
    });
    const count = await libraryRequest("rpc/replace_generated_mcq_questions", {
      _set_id: data.setId,
      _questions: questions.map((q) => ({
        question: q.question.trim(),
        options: q.options.map((o) => o.trim()),
        correct_index: q.correct_index,
        explanation: q.explanation.trim(),
      })),
    });
    return { questions: typeof count === "number" ? count : 0 };
  });
