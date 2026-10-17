/**
 * The question writer with figures on, tried on real spec points: one paid
 * Claude call per point (an 8-question quiz, as the practice queue writes it),
 * then each figure drawn as the worker draws it. Reads the points' contexts
 * from the database and writes nothing there: no run rows, no questions.
 *
 *   DEEPSEEK_API_KEY="$(cat ~/.deepseek_key)" bun scripts/figure-writer-trial.ts <spec point id> …
 *
 * Results go to scripts/figures/out/ (not committed) as cards for
 * /figures-preview, named w-<code>-<question>.
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { drawFigure } from "@/lib/figures/drawFigure.server";
import { checkFigure } from "@/lib/figures/figureCheck";
import {
  buildGenerationPrompt,
  generationSchema,
  validateQuestions,
  type GenerationContext,
} from "@/lib/homework/examGeneration";

const out = join(import.meta.dir, "figures", "out");
const ids = process.argv.slice(2);
if (!ids.length) throw new Error("Name at least one spec point id");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.ANTHROPIC_API_KEY)
  throw new Error("Needs .env's Supabase and Anthropic keys");

async function context(id: string): Promise<GenerationContext> {
  const res = await fetch(`${url}/rest/v1/rpc/exam_generation_context`, {
    method: "POST",
    headers: {
      apikey: key!,
      ...(key!.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ _spec_point_id: id }),
  });
  if (!res.ok) throw new Error(`context for ${id}: ${res.status} ${await res.text()}`);
  return (await res.json()) as GenerationContext;
}

const client = new Anthropic({ timeout: 200_000, maxRetries: 0 });
mkdirSync(out, { recursive: true });
let spent = 0;

await Promise.all(
  ids.map(async (id) => {
    const ctx = await context(id);
    const prompt = buildGenerationPrompt(ctx, 8, "mcq", "", true);
    const started = Date.now();
    const response = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 20_000,
      system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: generationSchema("mcq", true) },
      },
      messages: [{ role: "user", content: prompt.user }],
    });
    const cost = (response.usage.input_tokens * 2 + response.usage.output_tokens * 10) / 1e6;
    spent += cost;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const code = ctx.point.code.replace(/\W+/g, "-");
    let questions;
    try {
      questions = validateQuestions(JSON.parse(text), 8, "mcq", true);
    } catch (error) {
      console.log(
        `${ctx.point.code} ${ctx.point.title}: the set failed its check: ${(error as Error).message} ($${cost.toFixed(3)})`,
      );
      writeFileSync(join(out, `w-${code}-raw.txt`), text);
      return;
    }
    const withFigures = questions.filter((q) => q.figure || q.figureProblem);
    console.log(
      `${ctx.point.code} ${ctx.point.title}: ${withFigures.length} figure(s) in 8 questions, ${((Date.now() - started) / 1000).toFixed(0)} s, $${cost.toFixed(3)}`,
    );
    await Promise.all(
      questions.map(async (q, i) => {
        if (q.figureProblem) {
          console.log(`  Q${i + 1}: LEFT OUT, its brief ${q.figureProblem}`);
          console.log(`     ${q.question.replace(/\n/g, " / ")}`);
          return;
        }
        if (!q.figure) return;
        const request = {
          subject: ctx.point.subject,
          question: q.question,
          options: q.options,
          brief: q.figure,
        };
        const drawn = await drawFigure(request, Date.now() + 200_000);
        const ok = "ok" in drawn;
        console.log(
          `  Q${i + 1} ${q.figure.kind}: ${ok ? `drawn by ${drawn.ok.brief.drawn_by}` : `LEFT OUT: ${drawn.failed}`}`,
        );
        console.log(`     ${q.question.replace(/\n/g, " / ")}`);
        console.log(`     options: ${q.options.join(" | ")}  (key: ${"ABCD"[q.correct_index]})`);
        writeFileSync(
          join(out, `w-${code}-q${i + 1}.json`),
          JSON.stringify(
            {
              name: `w-${code}-q${i + 1}`,
              request,
              attempts: [
                {
                  attempt: 1,
                  reply: ok
                    ? {
                        status: "ok",
                        reason: "",
                        alt: drawn.ok.figure.alt,
                        labels: checkFigure(drawn.ok.figure.svg).labels,
                        svg: drawn.ok.figure.svg,
                      }
                    : null,
                  problems: ok ? [] : [drawn.failed],
                  status: ok ? "ok" : null,
                  cost: 0,
                  ms: 0,
                },
              ],
            },
            null,
            1,
          ),
        );
      }),
    );
  }),
);
console.log(`\nClaude: about $${spent.toFixed(2)}. Cards are on /figures-preview.`);
