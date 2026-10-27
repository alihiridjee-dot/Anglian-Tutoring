import "@tanstack/react-start/server-only";
import type { KnownBrief } from "./figure";
import { checkFigure, checkReply } from "./figureCheck";
import { drawWithCode, drawnByCode } from "./figureDraw";
import {
  FIGURE_ENDPOINT,
  FIGURE_REQUEST,
  figureMessages,
  retryMessage,
  type FigureRequest,
} from "./figurePrompt";

/** A drawn figure that passed its check, ready to save with its question. */
export type SavedFigure = {
  /** What a student's page reads: the checker's rebuilt drawing, and what it shows. */
  figure: { svg: string; alt: string };
  /**
   * What stays on the server: the brief (a profile's says which arrow is
   * which, so it can hold the answer) and what drew it.
   */
  brief: { brief: KnownBrief; drawn_by: "code" | "deepseek" };
};

export type DrawResult = { ok: SavedFigure } | { failed: string };

/**
 * One DeepSeek call's limit. A figure takes 10–70 s, thinking included: a
 * 12-organism food web took 70 s in the 17 Oct trial. A call that runs out
 * gets the other try, if the deadline leaves time for it.
 */
const ATTEMPT_MS = 120_000;
/** No call starts with less time than this left before the deadline. */
const LEAST_MS = 20_000;

/**
 * Draw one question's figure: by code for a graph, bar chart or reaction
 * profile, by DeepSeek for a circuit or food web, which gets one more try
 * with the checker's problems. Never throws; a figure that can't be drawn
 * and checked by `deadline` (ms since the epoch) comes back failed, and its
 * question is not saved.
 */
export async function drawFigure(request: FigureRequest, deadline: number): Promise<DrawResult> {
  try {
    return await draw(request, deadline);
  } catch (error) {
    // The checker reads what a model wrote: whatever it trips on costs this
    // question alone, never the set.
    return {
      failed: `couldn't be checked: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function draw(request: FigureRequest, deadline: number): Promise<DrawResult> {
  const brief = request.brief as KnownBrief;
  if (drawnByCode(brief)) {
    const drawn = drawWithCode(brief);
    if (!drawn) return { failed: "the brief doesn't fit its canvas" };
    const check = checkFigure(drawn.svg, brief);
    if (check.problems.length || !check.svg)
      return { failed: `code drew it wrong: ${check.problems.join("; ")}` };
    return {
      ok: { figure: { svg: check.svg, alt: drawn.alt }, brief: { brief, drawn_by: "code" } },
    };
  }
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { failed: "DEEPSEEK_API_KEY is not set" };
  const messages: { role: string; content: string }[] = figureMessages(request);
  let last = "no try";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const left = deadline - Date.now();
    if (left < LEAST_MS) return { failed: `out of time: ${last}` };
    let content: string;
    try {
      const res = await fetch(FIGURE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...FIGURE_REQUEST, messages }),
        signal: AbortSignal.timeout(Math.min(ATTEMPT_MS, left - 5_000)),
      });
      const body = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: string | null }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      } | null;
      if (!res.ok)
        return { failed: `DeepSeek answered ${res.status}: ${body?.error?.message ?? ""}` };
      content = body?.choices?.[0]?.message?.content ?? "";
      console.log(
        `[figures] ${brief.kind} try ${attempt}: ${body?.usage?.prompt_tokens ?? "?"} in, ${body?.usage?.completion_tokens ?? "?"} out, ${body?.choices?.[0]?.finish_reason ?? "?"}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Too slow this time is worth the other try, while there is time for it.
      if (error instanceof Error && error.name === "TimeoutError" && attempt < 2) {
        last = `timed out after ${Math.round(Math.min(ATTEMPT_MS, left - 5_000) / 1000)} s`;
        continue;
      }
      return { failed: `DeepSeek call failed: ${message}` };
    }
    let reply: unknown = null;
    try {
      reply = JSON.parse(content);
    } catch {
      // Checked below as a reply that isn't JSON.
    }
    const verdict = checkReply(reply, brief);
    if (verdict.figure)
      return { ok: { figure: verdict.figure, brief: { brief, drawn_by: "deepseek" } } };
    // A figure DeepSeek won't draw stays undrawn: asking again changes nothing.
    if (verdict.status && verdict.status !== "ok")
      return { failed: `DeepSeek answered ${verdict.status}` };
    last = verdict.problems.join("; ") || "unreadable";
    messages.push({ role: "assistant", content }, retryMessage(verdict.problems));
  }
  return { failed: last };
}
