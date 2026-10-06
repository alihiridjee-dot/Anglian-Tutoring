import { createServerFn } from "@tanstack/react-start";
import { CALL_LIMITS, generateExamQuestions, loadGenerationContext } from "./examGeneration.server";
import type { WrittenQuestion } from "./examGeneration";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SUBJECTS, LEVELS, BOARDS } from "@/lib/curriculum/taxonomy";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Drafting the written questions that make up a built-in homework.
 *
 * Unlike the MCQ generators this writes nothing to the database: it hands the
 * draft back to the tutor, who edits, re-marks or deletes questions in the form
 * and only then sets the homework. That keeps a half-reviewed, AI-written brief
 * from ever being visible to a student, and avoids needing a draft state on
 * `resources`.
 */

export type DraftQuestion = {
  prompt: string;
  marks: number;
  answer_type: "short" | "long" | "numeric";
  mark_scheme: string;
  spec_point_id: string | null;
};

type SupabaseServer = SupabaseClient<Database>;

async function requireTutor(supabase: SupabaseServer, userId: string) {
  const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((role ?? []) as Array<{ role: string }>).map((r) => r.role);
  if (!roles.includes("tutor")) throw new Error("Tutor access required");
}

/** The shared framework validates the whole set before these drafts are exposed. */
function toDrafts(raw: WrittenQuestion[], specPointId: string): DraftQuestion[] {
  return raw.map((q) => ({
    prompt: q.prompt.trim(),
    marks: q.marks,
    answer_type: q.answer_type,
    mark_scheme: q.mark_scheme.trim(),
    spec_point_id: specPointId,
  }));
}

type GenInput = {
  specPointIds: string[];
  subject: string;
  board: string;
  level: string;
  count: number;
  /** Free-text steer from the tutor, e.g. "focus on required practical 4". */
  notes?: string;
};

/**
 * Draft a homework's questions across the spec points the tutor picked.
 *
 * The requested count is spread over the selected points (at least one each), so
 * a homework covering three points comes back balanced rather than dwelling on
 * whichever point happened to be first. Each draft carries its spec point id, so
 * the questions stay tagged for the curriculum browser once saved.
 */
export const generateHomeworkQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GenInput) => {
    const ids = Array.isArray(input?.specPointIds)
      ? input.specPointIds.map(String).filter(Boolean)
      : [];
    if (ids.length === 0) throw new Error("Select at least one spec point first");
    const subject = SUBJECTS.find((s) => s.value === input?.subject)?.value;
    if (!subject) throw new Error("subject required");
    const level = LEVELS.find((l) => l.value === input?.level)?.value;
    if (!level) throw new Error("level required");
    const board = BOARDS.find((b) => b.value === input?.board)?.value;
    if (!board) throw new Error("board required");
    return {
      specPointIds: ids.slice(0, 8),
      subject,
      board,
      level,
      count: Math.min(Math.max(Number(input?.count) || 5, 1), 20),
      notes: String(input?.notes ?? "").slice(0, 500),
    };
  })
  .handler(async ({ data, context }): Promise<{ questions: DraftQuestion[] }> => {
    const { supabase, userId } = context;
    await requireTutor(supabase, userId);

    const { data: pointRows, error: pointErr } = await supabase
      .from("spec_points")
      .select("id, title, description")
      .in("id", data.specPointIds);
    if (pointErr) throw pointErr;

    const points = (
      (pointRows ?? []) as Array<{
        id: string;
        title: string;
        description: string | null;
      }>
    ).filter((p) => !!p?.id);
    if (points.length === 0) throw new Error("No matching spec points found");

    // Spread the requested total across the points, remainder to the first ones.
    const base = Math.floor(data.count / points.length);
    const remainder = data.count - base * points.length;
    const counts = points.map((_, i) => Math.max(1, base + (i < remainder ? 1 : 0)));

    const drafts: DraftQuestion[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const generation = await loadGenerationContext(supabase, p.id);
      if (
        generation.point.subject !== data.subject ||
        generation.point.level !== data.level ||
        generation.point.board !== data.board
      )
        throw new Error("Specification point does not match the selected course");
      const { questions: raw } = await generateExamQuestions(generation, counts[i], "written", {
        ...CALL_LIMITS,
        source: "builder",
        notes: data.notes,
      });
      drafts.push(...toDrafts(raw, p.id));
    }

    if (drafts.length === 0) throw new Error("No usable questions came back — try again");
    return { questions: drafts };
  });
