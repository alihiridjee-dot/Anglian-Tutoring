import "@tanstack/react-start/server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  FRAMEWORK_VERSION,
  buildGenerationPrompt,
  generationSchema,
  validateQuestions,
  type GenerationContext,
  type GenerationFormat,
  type WrittenQuestion,
  type McqQuestion,
} from "./examGeneration";

const MODEL = "claude-sonnet-5";

/** Privileged reads stay server-only; no public endpoint exposes the source library. */
async function libraryRequest(path: string, body: unknown): Promise<unknown> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Exam generation requires the server Supabase service credential");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Do not mistake a broken migration/credential for an empty exemplar library.
    throw new Error(
      `Exam generation database request failed (${response.status}); check framework migration and server credentials`,
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function loadGenerationContext(
  supabase: SupabaseClient<Database>,
  pointId: string,
): Promise<GenerationContext> {
  // This read uses the authenticated caller, so service-role retrieval cannot
  // let a student generate content for an inaccessible curriculum point.
  const { data: point, error } = await supabase
    .from("spec_points")
    .select("id")
    .eq("id", pointId)
    .single();
  if (error || !point) throw new Error("Specification point is unavailable");
  const value = await libraryRequest("rpc/exam_generation_context", { _spec_point_id: pointId });
  const context = value as GenerationContext | null;
  if (
    !context?.point ||
    context.point.id !== pointId ||
    !Array.isArray(context.examples) ||
    !Array.isArray(context.guidance)
  ) {
    throw new Error("Exam generation context is incomplete");
  }
  return context;
}

export async function generateExamQuestions(
  context: GenerationContext,
  count: number,
  format: "written",
  notes?: string,
): Promise<WrittenQuestion[]>;
export async function generateExamQuestions(
  context: GenerationContext,
  count: number,
  format: "mcq",
  notes?: string,
): Promise<McqQuestion[]>;
export async function generateExamQuestions(
  context: GenerationContext,
  count: number,
  format: GenerationFormat,
  notes = "",
): Promise<WrittenQuestion[] | McqQuestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const prompt = buildGenerationPrompt(context, count, format, notes);
  const client = new Anthropic({ apiKey });
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: Math.min(16000, Math.max(4000, count * (format === "written" ? 900 : 500))),
      system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
      output_config: { format: { type: "json_schema", schema: generationSchema(format) } },
      messages: [{ role: "user", content: prompt.user }],
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 429) throw new Error("AI rate limit — try again in a moment");
    throw new Error("Question generation failed; please try again");
  }
  if (response.stop_reason !== "end_turn") throw new Error("AI did not complete the question set");
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
  const questions = validateQuestions(value, count, format);
  // Audit only, not another generation/review call. Failure does not discard a valid set.
  try {
    await libraryRequest("exam_generation_runs", {
      spec_point_id: context.point.id,
      framework_version: FRAMEWORK_VERSION,
      model: MODEL,
      format,
      grounding: prompt.grounding,
      exemplar_ids: prompt.examples.map((e) => e.id),
      generated_questions: questions,
      usage: response.usage,
    });
  } catch (error) {
    console.error("[exam-generation] could not save generation trace", error);
  }
  return questions;
}
