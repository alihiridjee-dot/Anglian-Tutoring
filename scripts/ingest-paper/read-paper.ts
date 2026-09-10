/**
 * Read an exam paper with a model rather than a pattern.
 *
 * `split_paper.py` recovers most of a paper for nothing, but it recovers the
 * easy half: the questions. Dividing a multi-part mark scheme between the parts
 * it belongs to is not a layout problem, and 79% of the rows already loaded
 * have no mark scheme attached because of it. A row without its scheme cannot
 * be used to generate or to mark, so those rows are shelf-filler.
 *
 * So the whole paper goes to a cheap model, which reads both documents the way
 * a person would and returns the rows the loader already knows how to insert.
 *
 *   bun run scripts/ingest-paper/read-paper.ts papers/named/ocr-biology-gcse-2019-p1-QP.pdf
 *   bun run scripts/ingest-paper/read-paper.ts papers/named/*-QP.pdf --out papers/
 *
 * Output is the same JSON shape `split_paper.py --json` produces, so the rest
 * of the pipeline is unchanged:
 *
 *   read-paper.ts  ->  papers/<stem>.json  ->  load-exemplars.ts --write
 *
 * Two things keep this honest. The model is told to transcribe and never to
 * compose — a question it cannot represent faithfully comes back with a reason
 * instead of a guess, and is flagged rather than dropped. And the paper is read
 * twice: once for an index of what questions exist and what they are worth,
 * then in batches against that index, so marks that do not add up and questions
 * that went missing are both visible without anyone reading the PDF.
 *
 * Costs 30-50p a paper on Sonnet. The two documents are sent once and cached, so
 * every batch after the first reads them at a tenth the price and nearly all of
 * the bill is the transcription itself. Print the total it spent at the end.
 *
 * Needs ANTHROPIC_API_KEY and python3 with pypdf.
 */
import Anthropic from "@anthropic-ai/sdk";
import { basename, join } from "node:path";

const MODEL = flag("model") ?? "claude-sonnet-5";
// Sonnet 5, dollars per million tokens: in, cache write, cache read, out.
const PRICE: Record<string, [number, number, number, number]> = {
  "claude-sonnet-5": [2, 2.5, 0.2, 10],
  "claude-haiku-4-5-20251001": [1, 1.25, 0.1, 5],
  "claude-opus-5": [5, 6.25, 0.5, 25],
};

const args = process.argv.slice(2);
const valueFlags = new Set(["--out", "--model", "--batch"]);
const inputs = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));
const outDir = flag("out") ?? "papers";
const batchSize = Number(flag("batch") ?? 4);
if (inputs.length === 0)
  throw new Error("Give one or more -QP.pdf files (or their stems) from papers/named/");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set");
const client = new Anthropic({ apiKey });

// Every character it writes has to be in front of it. The tempting failure here
// is a model that quietly repairs a mangled question into a plausible one: that
// row would then teach generation to imitate the model rather than the board,
// and its mark scheme could mark a child's answer against the wrong thing.
const RULES = `You are transcribing a real exam paper into structured rows. You are not writing questions.

Copy. Do not compose. Every word of a prompt, an option and a mark scheme must appear in the documents given to you. Do not reword, modernise, summarise, complete or correct anything, even when the source is obviously damaged by PDF extraction.

If you cannot represent a question faithfully from what is in front of you, set "unusable_reason" and say what is missing. That is the correct outcome and costs nothing. Inventing the missing part is the one unrecoverable mistake.

One row per answerable part. A question with parts (a), (b)(i), (b)(ii) is three rows, not one; a question with no parts is one row.

Group the rows under their question. Each question has a number, one shared stem, and its parts.

- "shared_context": the stem the parts share — the scenario, the data table, the extract — copied verbatim, once for the whole question. Null if there is none. Write it once here; it is attached to every part for you. A part's own prompt must never depend on text you left behind.
- "label": exactly as the paper prints it, e.g. "7", "7(a)", "7(b)(ii)", "04.3".
- "prompt": this part's own question text, verbatim, without the shared stem and without the printed marks. Leave out the furniture the candidate writes into: dotted answer lines, ruled space, "Your answer", answer boxes and the printed unit beside them.
- "options": multiple-choice options as printed. Null unless the paper prints them. Never write options yourself.
- "marks": the mark allocation printed for this part.
- "mark_scheme": this part's own answer and marking guidance from the mark scheme document, verbatim, including accept/allow/ignore notes and any error-carried-forward rule. Not the whole question's scheme, and not another part's. Null if the mark scheme genuinely does not cover this part.

  Mark schemes are printed as a table — the creditworthy answer in one column, the examiner's guidance in another — and extraction interleaves the two line by line, so a sentence of the answer is often cut in half by a note about it. Put the columns back: the answer as continuous text first, then the guidance after a line reading "Guidance:". Keep both. This is un-interleaving what the page printed side by side, and it is the only reordering you may do.
- "needs_image": true when answering requires a figure, graph, diagram or photograph that is not present as text. Extraction drops images, so this is common and is not a failure.
- "command_word": the instruction the part is built on — Describe, Explain, Calculate, State, Evaluate, Suggest, Compare. Null if there is none.
- "assessment_objectives": only if the mark scheme prints them. Extraction breaks them apart, so write them as the board means them: "AO 2 1", "AO2 1" and "AO2.1" are all ["AO2.1"]. Empty array if the scheme does not print them.
- "question_format": "mcq" when options are printed, otherwise "written".
- "mathematical_demand" / "practical_demand": whether answering requires calculation or manipulation of quantities, and whether it draws on practical or experimental technique. These are judgements about the question, and both can be true.
- "unusable_reason": null when the row is complete and faithful. Otherwise a short reason: the options are missing, the text is garbled, the mark scheme is unreadable.

Skip everything that is not a question: cover pages, instructions to candidates, formula sheets, periodic tables, blank pages, "Turn over", page footers and running headers.`;

type Manifest = {
  paper_total: number | null;
  questions: { number: string; total_marks: number | null; part_labels: string[] }[];
};

type Part = {
  label: string;
  prompt: string;
  options: { letter: string; text: string }[] | null;
  marks: number | null;
  mark_scheme: string | null;
  needs_image: boolean;
  command_word: string | null;
  assessment_objectives: string[];
  question_format: string;
  mathematical_demand: boolean | null;
  practical_demand: boolean | null;
  unusable_reason: string | null;
};
type Row = Part & { q: string; shared_context: string | null; flags: string[] };

const manifestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["paper_total", "questions"],
  properties: {
    paper_total: { type: ["integer", "null"] },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "total_marks", "part_labels"],
        properties: {
          number: { type: "string" },
          total_marks: { type: ["integer", "null"] },
          part_labels: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const partProperties = {
  required: [
    "label",
    "prompt",
    "options",
    "marks",
    "mark_scheme",
    "needs_image",
    "command_word",
    "assessment_objectives",
    "question_format",
    "mathematical_demand",
    "practical_demand",
    "unusable_reason",
  ],
  properties: {
    label: { type: "string" },
    prompt: { type: "string" },
    options: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["letter", "text"],
        properties: { letter: { type: "string" }, text: { type: "string" } },
      },
    },
    marks: { type: ["integer", "null"] },
    mark_scheme: { type: ["string", "null"] },
    needs_image: { type: "boolean" },
    command_word: { type: ["string", "null"] },
    assessment_objectives: { type: "array", items: { type: "string" } },
    question_format: { type: "string", enum: ["written", "mcq"] },
    mathematical_demand: { type: ["boolean", "null"] },
    practical_demand: { type: ["boolean", "null"] },
    unusable_reason: { type: ["string", "null"] },
  },
};

const rowsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["q", "shared_context", "parts"],
        properties: {
          q: { type: "string" },
          shared_context: { type: ["string", "null"] },
          parts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: partProperties.required,
              properties: partProperties.properties,
            },
          },
        },
      },
    },
  },
};

const spend = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };

/** The two documents as text. Sent once per paper and cached; every later call
 *  in the paper reads that cache instead of paying for the paper again. */
async function paperText(qp: string, ms: string) {
  const proc = Bun.spawn(["python3", "scripts/ingest-paper/split_paper.py", qp, ms, "--text"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) throw new Error(`could not read the PDFs: ${err.trim()}`);
  return JSON.parse(out) as { profile: string | null; qp: string; ms: string };
}

class TooLong extends Error {}

async function ask(
  documents: string,
  task: string,
  schema: Record<string, unknown>,
  maxTokens: number,
): Promise<unknown> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    system: [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema } },
    messages: [
      {
        role: "user",
        content: [
          // The cache breakpoint sits on the documents, so the varying half of
          // the request has to come after them.
          { type: "text", text: documents, cache_control: { type: "ephemeral" } },
          { type: "text", text: task },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  const u = message.usage;
  spend.input += u.input_tokens;
  spend.cacheWrite += u.cache_creation_input_tokens ?? 0;
  spend.cacheRead += u.cache_read_input_tokens ?? 0;
  spend.output += u.output_tokens;
  // A batch of long questions can outrun max_tokens. That is a batch-size
  // problem, not a paper problem, so it is signalled rather than fatal.
  if (message.stop_reason === "max_tokens") throw new TooLong();
  if (message.stop_reason !== "end_turn")
    throw new Error(`model stopped early: ${message.stop_reason}`);
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text);
}

/** What the parser used to check with a regex, checked against the model's own
 *  index of the paper instead: a question that vanished between the index and
 *  the rows is the failure worth catching, and it is silent otherwise. */
function verify(rows: Row[], manifest: Manifest) {
  const byQuestion = new Map<string, Row[]>();
  for (const row of rows) byQuestion.set(row.q, [...(byQuestion.get(row.q) ?? []), row]);

  for (const row of rows) {
    if (row.unusable_reason) row.flags.push(row.unusable_reason);
    if (row.needs_image) row.flags.push("needs image");
    if (!row.mark_scheme?.trim()) row.flags.push("no mark scheme for this part");
    if (row.marks === null) row.flags.push("no mark allocation");
    if (row.question_format === "mcq" && !row.options?.length) row.flags.push("options missing");
  }

  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const q of manifest.questions) {
    const parts = byQuestion.get(q.number);
    if (!parts?.length) {
      missing.push(q.number);
      continue;
    }
    const found = parts.reduce((n, r) => n + (r.marks ?? 0), 0);
    if (q.total_marks !== null && found !== q.total_marks) {
      mismatched.push(`${q.number} (${found} of ${q.total_marks})`);
      for (const part of parts) part.flags.push(`question ${q.number} marks do not add up`);
    }
  }
  const found = rows.reduce((n, r) => n + (r.marks ?? 0), 0);
  return { missing, mismatched, found, stated: manifest.paper_total };
}

function money(): string {
  const [pin, pwrite, pread, pout] = PRICE[MODEL] ?? [0, 0, 0, 0];
  const usd =
    (spend.input * pin +
      spend.cacheWrite * pwrite +
      spend.cacheRead * pread +
      spend.output * pout) /
    1e6;
  return `$${usd.toFixed(2)}`;
}

for (const input of inputs) {
  const stem = input.replace(/-(QP|MS)\.pdf$/i, "").replace(/\.pdf$/i, "");
  const name = basename(stem);
  const [qp, ms] = [`${stem}-QP.pdf`, `${stem}-MS.pdf`];
  for (const path of [qp, ms])
    if (!(await Bun.file(path).exists())) throw new Error(`${path} is missing`);

  process.stdout.write(`${name}\n  reading the PDFs`);
  const text = await paperText(qp, ms);
  const documents =
    `QUESTION PAPER\n<<<\n${text.qp}\n>>>\n\n` + `MARK SCHEME\n<<<\n${text.ms}\n>>>`;

  process.stdout.write("\r  indexing the paper   ");
  const manifest = (await ask(
    documents,
    "Index this paper before transcribing anything. List every question, the labels of its answerable parts, and the total marks printed for that question. Also give the total marks for the whole paper as stated on the cover, or null if the cover does not state one.",
    manifestSchema,
    24000,
  )) as Manifest;

  const rows: Row[] = [];
  const batches: Manifest["questions"][] = [];
  for (let i = 0; i < manifest.questions.length; i += batchSize)
    batches.push(manifest.questions.slice(i, i + batchSize));

  // Halve a batch that overran and try again, down to a single question. One
  // enormous question stops itself, not the other forty papers behind it.
  async function transcribe(batch: Manifest["questions"]): Promise<void> {
    const numbers = batch.map((q) => q.number);
    process.stdout.write(
      `\r  transcribing question${batch.length > 1 ? "s" : ""} ${numbers.join(", ")}   `,
    );
    let result;
    try {
      result = (await ask(
        documents,
        `Transcribe questions ${numbers.join(", ")} only, one row per answerable part, ` +
          `following the rules exactly. Expected parts: ` +
          batch.map((q) => `${q.number} -> ${q.part_labels.join(", ") || "no parts"}`).join("; ") +
          `. Return every one of them, including any you have to mark unusable.`,
        rowsSchema,
        24000,
      )) as { questions: { q: string; shared_context: string | null; parts: Part[] }[] };
    } catch (error) {
      if (!(error instanceof TooLong)) throw error;
      if (batch.length === 1) {
        overran.push(numbers[0]);
        return;
      }
      const half = Math.ceil(batch.length / 2);
      await transcribe(batch.slice(0, half));
      await transcribe(batch.slice(half));
      return;
    }
    // The stem is written once and attached here, so a part carries everything
    // it needs without the model paying to repeat it for every sibling.
    for (const question of result.questions)
      for (const part of question.parts)
        rows.push({ ...part, q: question.q, shared_context: question.shared_context, flags: [] });
  }

  const overran: string[] = [];
  for (const batch of batches) await transcribe(batch);

  const report = verify(rows, manifest);
  const out = join(outDir, `${name}.json`);
  if (!args.includes("--dry"))
    await Bun.write(
      out,
      JSON.stringify(
        { profile: `model:${MODEL}`, source_profile: text.profile, rows, scheme: [] },
        null,
        1,
      ),
    );

  const clean = rows.filter((r) => !r.flags.length).length;
  const images = rows.filter((r) => r.needs_image).length;
  const unusable = rows.filter((r) => r.unusable_reason).length;
  process.stdout.write("\r" + " ".repeat(60) + "\r");
  console.log(
    `  ${rows.length} rows — ${clean} clean, ${images} need an image, ${unusable} unusable\n` +
      `  ${report.found} marks found` +
      (report.stated === null
        ? ", no paper total on the cover to check against"
        : ` of ${report.stated} stated on the cover`) +
      (report.mismatched.length ? `\n  marks do not add up: ${report.mismatched.join(", ")}` : "") +
      (report.missing.length
        ? `\n  questions indexed but not returned: ${report.missing.join(", ")}`
        : "") +
      (overran.length ? `\n  too long to transcribe in one response: ${overran.join(", ")}` : "") +
      (args.includes("--dry") ? "\n  Dry run, nothing written." : `\n  wrote ${out}`),
  );
}

console.log(
  `\n  ${money()} on ${MODEL} ` +
    `(${spend.input + spend.cacheWrite + spend.cacheRead} in, ${spend.cacheRead} from cache, ${spend.output} out)`,
);
