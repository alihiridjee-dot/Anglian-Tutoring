/**
 * The DeepSeek figure trial.
 *
 *   bun scripts/figure-trial.ts            dry run: the questions, the prompt's size, roughly what a run costs
 *   bun scripts/figure-trial.ts run        send them (needs DEEPSEEK_API_KEY in .env); one paid call each,
 *                                          plus one retry for a figure the checker rejects
 *   bun scripts/figure-trial.ts run --case peroxide-profile
 *   bun scripts/figure-trial.ts prompt     print the system message
 *   bun scripts/figure-trial.ts doc        rewrite docs/prompts/deepseek-figure-prompt.md
 *
 * Each run is saved to scripts/figures/out/<case>.json (not committed): every
 * attempt's reply, its usage and cost, and the checker's problems. The dev
 * server shows them at /figures-preview.
 *
 * `run` is paid (DeepSeek, a few cents): show Ali the dry run and run it only
 * after a clear yes, every time (AGENTS.md, rule 12). It only draws figures for
 * the questions in trialCases.ts; quiz and task writing goes through
 * scripts/practice-queue.ts alone.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkReply } from "@/lib/figures/figureCheck";
import { figurePromptDoc } from "@/lib/figures/figureDoc";
import {
  FIGURE_ENDPOINT,
  FIGURE_PRICE,
  FIGURE_PROMPT,
  FIGURE_REQUEST,
  figureMessages,
  retryMessage,
} from "@/lib/figures/figurePrompt";
import { TRIAL_CASES } from "./figures/trialCases";

const root = join(import.meta.dir, "..");
const out = join(import.meta.dir, "figures", "out");
const [command = "dry", ...rest] = process.argv.slice(2);
const only = rest.includes("--case") ? rest[rest.indexOf("--case") + 1] : undefined;
const cases = TRIAL_CASES.filter((c) => !only || c.name === only);
if (only && !cases.length) fail(`No trial case is called "${only}"`);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Peak hours: 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday. */
function price(at = new Date()) {
  const h = at.getUTCHours();
  const weekday = at.getUTCDay() >= 1 && at.getUTCDay() <= 5;
  return weekday && ((h >= 1 && h < 4) || (h >= 6 && h < 10))
    ? FIGURE_PRICE.peak
    : FIGURE_PRICE.offPeak;
}

type Usage = {
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};
const dollars = (u: Usage, p = price()) =>
  ((u.prompt_cache_hit_tokens ?? 0) * p.cachedInput +
    (u.prompt_cache_miss_tokens ?? u.prompt_tokens ?? 0) * p.input +
    (u.completion_tokens ?? 0) * p.output) /
  1e6;

async function call(messages: { role: string; content: string }[]) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) fail("DEEPSEEK_API_KEY is not in .env: nothing was sent");
  const started = Date.now();
  const res = await fetch(FIGURE_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...FIGURE_REQUEST, messages }),
  });
  const body = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: Usage;
    error?: { message?: string };
  } | null;
  if (!res.ok)
    fail(`DeepSeek answered ${res.status}: ${body?.error?.message ?? "no reason given"}`);
  return {
    content: body?.choices?.[0]?.message?.content ?? "",
    finish: body?.choices?.[0]?.finish_reason ?? "",
    usage: body?.usage ?? {},
    ms: Date.now() - started,
  };
}

async function run() {
  mkdirSync(out, { recursive: true });
  let total = 0;
  for (const c of cases) {
    const messages: { role: string; content: string }[] = figureMessages(c.request);
    const attempts = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await call(messages);
      let reply: unknown = null;
      try {
        reply = JSON.parse(r.content);
      } catch {
        // Recorded below as a reply that isn't JSON.
      }
      const verdict = checkReply(reply, c.request.brief);
      const cost = dollars(r.usage);
      total += cost;
      attempts.push({
        attempt,
        reply,
        raw: reply ? undefined : r.content,
        finish: r.finish,
        ms: r.ms,
        usage: r.usage,
        cost,
        ...verdict,
      });
      console.log(
        `${c.name} try ${attempt}: ${verdict.status ?? "unreadable"}, ${verdict.problems.length} problem(s), ${(r.ms / 1000).toFixed(0)} s, $${cost.toFixed(4)}`,
      );
      for (const p of verdict.problems) console.log(`   - ${p}`);
      if (!verdict.problems.length || verdict.status !== "ok") break;
      messages.push({ role: "assistant", content: r.content }, retryMessage(verdict.problems));
    }
    const last = attempts[attempts.length - 1];
    writeFileSync(
      join(out, `${c.name}.json`),
      JSON.stringify(
        {
          name: c.name,
          request: c.request,
          ranAt: new Date().toISOString(),
          attempts,
          shown: last.figure,
        },
        null,
        1,
      ),
    );
  }
  console.log(
    `\nSpent about $${total.toFixed(4)}. Results in scripts/figures/out/; see them at /figures-preview.`,
  );
}

function dry() {
  const promptTokens = Math.round(FIGURE_PROMPT.length / 3.2);
  const p = price();
  // Each call: the prompt (cached after the first), the question, and up to ~9 000 tokens of thinking and SVG.
  const perCall = (promptTokens * p.input + 300 * p.input + 9_000 * p.output) / 1e6;
  console.log(`System message: ${FIGURE_PROMPT.length} characters, about ${promptTokens} tokens.`);
  console.log(
    `Model: ${FIGURE_REQUEST.model}, thinking ${FIGURE_REQUEST.reasoning_effort}; ${p === FIGURE_PRICE.peak ? "peak" : "off-peak"} prices now.\n`,
  );
  for (const c of cases)
    console.log(`  ${c.name.padEnd(18)} ${c.request.brief.kind}: ${c.request.question}`);
  console.log(
    `\n${cases.length} question(s): at most about $${(perCall * cases.length * 2).toFixed(2)} if every figure needs its retry, about $${(perCall * cases.length).toFixed(2)} if none does.`,
  );
  console.log("Nothing was sent. `bun scripts/figure-trial.ts run` sends them.");
}

if (command === "dry") dry();
else if (command === "run") await run();
else if (command === "prompt") console.log(FIGURE_PROMPT);
else if (command === "doc") {
  const file = join(root, "docs", "prompts", "deepseek-figure-prompt.md");
  mkdirSync(join(root, "docs", "prompts"), { recursive: true });
  writeFileSync(file, figurePromptDoc());
  console.log(`Wrote ${file}`);
} else fail(`Unknown command "${command}": use dry, run, prompt or doc`);
