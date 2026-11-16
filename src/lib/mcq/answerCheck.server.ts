import "@tanstack/react-start/server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { GenerationPoint, McqQuestion } from "../homework/examGeneration";
import {
  GenerationError,
  classifyApiError,
  recordRun,
  type GenerationSource,
} from "../homework/examGeneration.server";

// The answer check: every generated multiple-choice question is solved again
// by a model that is never shown its key, and is saved only when that answer
// is the key. The writer checks its own working first (`answerProblem`, from
// `validateQuestions`); this is the second, independent look.
//
// It exists because a quiz went live on 16 Nov 2026 asking "In which change is
// sulfur oxidised?" with four options that were all reductions or no change.
// Nothing then looked at whether a key was right, only at a question's shape.
//
// A cheaper, different model solves the whole set first. Only the questions it
// disagrees on go to the writer's own model, as a tie-break: a question is
// dropped when that second answer isn't the key either. Each call is an
// `exam_generation_runs` row of format `mcq_check`, and the database refuses a
// generated question that doesn't name one (20261116190000_mcq_answer_check).

export const ANSWER_CHECK_VERSION = "answer-check-v1";
/** Solves every question in the set. A different model from the writer's, so it doesn't share its slips. */
export const FIRST_SOLVER = "claude-haiku-5-5";
/** Solves only the questions the first solver disagreed on. */
export const SECOND_SOLVER = "claude-sonnet-5-5";

/** A quiz with fewer questions than this left after its checks isn't saved. */
export const MIN_QUIZ_QUESTIONS = 5;

const LETTERS = ["A", "B", "C", "D"] as const;
const VERDICTS = [...LETTERS, "none", "several"] as const;
type Verdict = (typeof VERDICTS)[number];

/** One call's limit when the caller sets no deadline. A set is solved in well under a minute. */
const CALL_TIMEOUT_MS = 90_000;
/** Too little time left to start a call that could finish. */
const MIN_CALL_MS = 5_000;

export interface AnswerCheckOptions {
  source: GenerationSource;
  /** The practice-queue job the questions were written for. */
  jobId?: number | null;
  /** When the caller must be done (ms since the epoch): no call is given longer. */
  deadline?: number;
}

/** What the solver is shown of a question: everything a student sees, and no key. */
type BlindQuestion = Pick<McqQuestion, "question" | "options" | "figure" | "optionFigures">;

export const SOLVER_SYSTEM = `You check multiple-choice science questions before students see them. Each was written for the curriculum point given. You are not told which option its writer meant to be right.

For each question, work the answer out yourself from the question alone, at the level this curriculum teaches, before you compare the options. Then test every option against your working. Give the letter of the one option an examiner would credit. Where a question asks for the best or most likely answer, that is the option clearly better than the rest.

Answer "none" when no option is correct. Answer "several" when more than one option is correct, or when the question cannot be settled from what it gives. Both happen, and finding them is the purpose of this check: never pick the nearest option to avoid them.

A figure is given as the data it is drawn from. Answer pictures are given the same way, one per option.

Return one entry per question, in order: n (the question's number), working (brief), then answer.`;

const SOLVER_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        // Working before the answer, for the reason the writer's verdicts come
        // before its key: fields are written in this order.
        properties: {
          n: { type: "integer" },
          working: { type: "string" },
          answer: { type: "string", enum: VERDICTS },
        },
        required: ["n", "working", "answer"],
        additionalProperties: false,
      },
    },
  },
  required: ["answers"],
  additionalProperties: false,
};

const block = (name: string, value: unknown) =>
  `<${name}>\n${JSON.stringify(value).replace(/</g, "\\u003c")}\n</${name}>`;

/** The solver's request for a set: the curriculum point, then each question as a student meets it. */
export function solverPrompt(point: GenerationPoint, questions: BlindQuestion[]): string {
  return [
    block("curriculum", {
      board: point.board,
      qualification: point.level,
      subject: point.subject,
      tier: point.tier,
      code: point.code,
      title: point.title,
      description: point.description,
    }),
    block(
      "questions",
      questions.map((q, i) => ({
        n: i + 1,
        question: q.question,
        options: Object.fromEntries(q.options.map((o, k) => [LETTERS[k], o])),
        ...(q.figure ? { figure: q.figure } : {}),
        ...(q.optionFigures
          ? { answer_pictures: Object.fromEntries(q.optionFigures.map((f, k) => [LETTERS[k], f])) }
          : {}),
      })),
    ),
    `Solve each of the ${questions.length} questions.`,
  ].join("\n\n");
}

/** One verdict per question, in order, or the reason the answer can't be read as that. */
function readVerdicts(stopReason: string | null, text: string, count: number): Verdict[] {
  if (stopReason !== "end_turn") throw new Error("The answer check was cut off");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The answer check returned invalid JSON");
  }
  const answers = (value as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers) || answers.length !== count)
    throw new Error("The answer check did not answer every question");
  return answers.map((a, i) => {
    const { n, answer } = (a ?? {}) as { n?: unknown; answer?: unknown };
    if (n !== i + 1 || !VERDICTS.includes(answer as Verdict))
      throw new Error(`The answer check's entry ${i + 1} is not an answer to question ${i + 1}`);
    return answer as Verdict;
  });
}

/**
 * One blind solve of `questions` by `model`: its verdicts, and the run row
 * that records them. Throws a `GenerationError` when the call fails, its
 * answer can't be read, or the row can't be written, since a check nobody
 * can point to proves nothing.
 */
async function solve(
  model: string,
  point: GenerationPoint,
  questions: BlindQuestion[],
  keys: string[],
  opts: AnswerCheckOptions,
): Promise<{ verdicts: Verdict[]; runId: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new GenerationError("ANTHROPIC_API_KEY not configured", "outage", 30, null);
  const timeout = Math.min(
    CALL_TIMEOUT_MS,
    opts.deadline === undefined ? CALL_TIMEOUT_MS : opts.deadline - Date.now(),
  );
  if (timeout < MIN_CALL_MS)
    throw new GenerationError("No time was left to check the answers", "retry", 0, null);
  // No SDK retries, as for the writer: each would be a paid call behind one row.
  const client = new Anthropic({ apiKey, timeout, maxRetries: 0 });
  const call = {
    spec_point_id: point.id,
    framework_version: ANSWER_CHECK_VERSION,
    model,
    format: "mcq_check",
    grounding: "blind",
    exemplar_ids: [],
    source: opts.source,
    job_id: opts.jobId ?? null,
  };
  const started = Date.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      // Thinking counts against this, and both models think by default.
      max_tokens: 16_000,
      system: SOLVER_SYSTEM,
      output_config: {
        // Pinned: the first solver's default is lower, and this is the one
        // job where a careful answer is the whole point.
        effort: "high",
        format: { type: "json_schema", schema: SOLVER_SCHEMA },
      },
      messages: [{ role: "user", content: solverPrompt(point, questions) }],
    });
  } catch (error) {
    const { failure, pauseMinutes, message } = classifyApiError(error);
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    const runId = await recordRun({
      ...call,
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
      api_status: typeof status === "number" && status >= 400 && status <= 599 ? status : null,
      usage: null,
      generated_questions: null,
      duration_ms: Date.now() - started,
    });
    const failed = new GenerationError(message, failure, pauseMinutes, runId);
    failed.cause = error;
    throw failed;
  }
  const answered = {
    ...call,
    model: response.model,
    stop_reason: response.stop_reason,
    usage: response.usage,
    duration_ms: Date.now() - started,
  };
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let verdicts: Verdict[];
  try {
    if (response.stop_reason === "refusal")
      throw new Error(
        `The answer check was refused (${response.stop_details?.category ?? "unknown"})`,
      );
    verdicts = readVerdicts(response.stop_reason, text, questions.length);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const runId = await recordRun({
      ...answered,
      outcome: "failed",
      error: message,
      raw_output: Array.from(text).slice(0, 20_000).join(""),
      generated_questions: null,
    });
    // A refusal would be refused again; anything else is worth another go.
    throw new GenerationError(
      message,
      response.stop_reason === "refusal" ? "give_up" : "retry",
      0,
      runId,
    );
  }
  const runId = await recordRun({
    ...answered,
    outcome: "passed",
    // What was asked and what came back, side by side, for whoever audits a key.
    generated_questions: {
      checked: questions.map((q, i) => ({
        question: q.question,
        key: keys[i],
        answer: verdicts[i],
        agreed: verdicts[i] === keys[i],
      })),
    },
  });
  if (!runId) throw new GenerationError("The answer check could not be recorded", "retry", 0, null);
  return { verdicts, runId };
}

/**
 * For each question, the run that confirmed its key, or null when its key
 * can't be trusted and the question must be left out: its writer's own
 * verdicts don't back it, or neither solver answered with it.
 *
 * Throws a `GenerationError` when the check itself can't be done. Nothing is
 * ever confirmed by default.
 */
export async function checkAnswers(
  point: GenerationPoint,
  questions: McqQuestion[],
  opts: AnswerCheckOptions,
): Promise<(string | null)[]> {
  const confirmed: (string | null)[] = questions.map(() => null);
  const about = opts.jobId ? `job ${opts.jobId}` : point.code;
  // The writer's own working comes first, and costs nothing to read.
  let open = questions.flatMap((q, i) => {
    if (!q.answerProblem) return [i];
    console.warn(`[answer-check] ${about} question ${i + 1} ${q.answerProblem}, so it is left out`);
    return [];
  });
  if (!open.length) return confirmed;
  const key = (i: number) => LETTERS[questions[i].correct_index];

  for (const model of [FIRST_SOLVER, SECOND_SOLVER]) {
    let solved: { verdicts: Verdict[]; runId: string };
    try {
      solved = await solve(
        model,
        point,
        open.map((i) => questions[i]),
        open.map(key),
        opts,
      );
    } catch (error) {
      // The second solver is the last word: without it there is no check.
      if (model === SECOND_SOLVER) throw error;
      // Without the first, every question goes to the second.
      console.warn(
        `[answer-check] ${about}: ${model} gave no answers, so ${SECOND_SOLVER} solves the set`,
        error,
      );
      continue;
    }
    open = open.filter((i, k) => {
      if (solved.verdicts[k] !== key(i)) return true;
      confirmed[i] = solved.runId;
      return false;
    });
    if (!open.length) break;
    if (model === SECOND_SOLVER)
      for (const i of open)
        console.warn(
          `[answer-check] ${about} question ${i + 1} is keyed ${key(i)} but neither solver agreed, so it is left out`,
        );
  }
  return confirmed;
}
