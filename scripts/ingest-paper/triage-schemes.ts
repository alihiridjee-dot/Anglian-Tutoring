/**
 * Find the exemplar rows most likely to carry a wrong mark scheme, so a person
 * reviews hundreds of rows rather than twenty thousand.
 *
 *   bun run scripts/ingest-paper/triage-schemes.ts                    # everything
 *   bun run scripts/ingest-paper/triage-schemes.ts biology gcse       # one subject (and level)
 *
 * Offline and read-only: it reads papers/done/<stem>.json and the PDFs beside
 * them, and writes papers/triage/<scope>.tsv, worst first. Nothing touches the
 * database — flagging the rows that a reviewer confirms is a separate step.
 *
 * Every check is mechanical, and each catches one way a row has gone wrong
 * before (the 2026-10-01 audit):
 *
 *   ms_not_in_pdf    the scheme's text is mostly absent from the scheme PDF:
 *                    composed, or another question's
 *   prompt_not_in_qp the prompt or its stem is absent from the question paper:
 *                    retold from a figure, or invented
 *   sibling_ms       another part of the same paper has the identical scheme
 *   guidance_only    the scheme is only "Guidance: …" — the answer was a drawing
 *   thin_ms          two or more marks, almost no scheme (usually a fine
 *                    one-word answer, so it ranks lowest)
 *   drawn_answer     draw-a-line / tick-box / complete-the-table: the answer is a drawing,
 *                    so the text could not have carried it
 *
 * papers/triage/reviewed.tsv (stem, label, verdict) lists rows a person has
 * already checked; they are skipped.
 *
 * Short answers are not a signal. An MCQ letter, a number or a one-word answer
 * is too short to sample, so it is checked by exact match only and a miss is
 * not scored — "C" is a perfectly good mark scheme.
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

const ROOT = join(import.meta.dir, "../../../../..", "papers");
const PAPERS = existsSync(join(import.meta.dir, "../../papers/done"))
  ? join(import.meta.dir, "../../papers")
  : ROOT;
const DONE = join(PAPERS, "done");
const scope = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const norm = (s: unknown) =>
  String(s ?? "").replace(/×/g, "x").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// Fraction of 12-character windows found in the haystack. Below a sampleable
// length the answer is checked whole, and `null` means "too short to judge".
const N = 12;
function cover(fragment: unknown, hay: string): number | null {
  const f = norm(fragment);
  if (f.length < N * 2) return f.length >= 4 && hay.includes(f) ? 1 : null;
  let hit = 0, tot = 0;
  for (let i = 0; i + N <= f.length; i += 4) { tot++; if (hay.includes(f.slice(i, i + N))) hit++; }
  return hit / tot;
}

// Share of the fragment's words and numbers found anywhere in the document. A
// table flattened into a sentence fails the window check (its order changed)
// but passes this one; a retold figure brings words the paper never printed.
function words(fragment: unknown, qpWords: Set<string>): number {
  const w = String(fragment ?? "").toLowerCase().normalize("NFKD").match(/[a-z]{4,}|\d+(\.\d+)?/g) ?? [];
  return w.length ? w.filter((x) => qpWords.has(x)).length / w.length : 1;
}

const pdfText = (p: string) => {
  try { return execFileSync("pdftotext", [p, "-"], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).toString(); }
  catch { return ""; }
};
// A calculation or a fill-the-gaps list: a few words a line, so window order
// means nothing, and there is no prose for another question's scheme to hide in.
const terse = (a: string) => {
  const lines = a.split(/\n| · /).filter((l) => l.trim());
  return lines.length > 0 && lines.every((l) => (l.match(/[a-z]{4,}/gi) ?? []).length <= 3);
};
// The scheme's answer, without the examiner guidance that follows it.
const answerPart = (ms: unknown) => String(ms ?? "").split(/\n?Guidance:/)[0];
const isLetterAnswer = (ms: unknown) => /^\s*(answer:\s*)?[A-J]\.?\s*(\(1\))?\s*($|\n)/i.test(String(ms ?? ""));
const DRAWN = /(draw (one|a|two)? ?lines?|draw lines|link each|complete (the )?table|tick \(?✓?\)? ?(one|two|three)? ?box)/i;

type Hit = { stem: string; label: string; marks: number | null; score: number; checks: string[]; prompt: string; scheme: string };
const hits: Hit[] = [];
const unchecked: string[] = [];
let total = 0;

// Rows a person has already checked against the PDFs: <stem>\t<label>\t<verdict>.
const reviewedFile = join(PAPERS, "triage", "reviewed.tsv");
const reviewed = new Set(
  existsSync(reviewedFile)
    ? readFileSync(reviewedFile, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t").slice(0, 2).join("\t"))
    : [],
);

const stems = readdirSync(DONE)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .filter((s) => scope.every((w) => s.split("-").includes(w)))
  .sort();

for (const stem of stems) {
  let rows: any[];
  try { rows = JSON.parse(readFileSync(join(DONE, `${stem}.json`), "utf8")).rows ?? []; }
  catch { unchecked.push(`${stem} (unreadable json)`); continue; }
  total += rows.length;

  const qpRaw = pdfText(join(DONE, `${stem}-QP.pdf`));
  const qp = norm(qpRaw);
  const qpWords = new Set(qpRaw.toLowerCase().normalize("NFKD").match(/[a-z]{4,}|\d+(\.\d+)?/g) ?? []);
  const msRaw = pdfText(join(DONE, `${stem}-MS.pdf`));
  const ms = norm(msRaw);
  const msWords = new Set(msRaw.toLowerCase().normalize("NFKD").match(/[a-z]{4,}|\d+(\.\d+)?/g) ?? []);
  const qpOk = qp.length > 2000, msOk = ms.length > 2000;
  if (!qpOk || !msOk) unchecked.push(`${stem} (${!qpOk ? "QP" : "MS"} has no text layer — scan, review by eye)`);

  const byScheme = new Map<string, string[]>();
  for (const r of rows) {
    // MCQ letters repeat by design, often with the same boilerplate guidance.
    const k = norm(r.mark_scheme);
    if (k.length > 15 && !isLetterAnswer(r.mark_scheme)) byScheme.set(k, [...(byScheme.get(k) ?? []), r.label]);
  }

  for (const r of rows) {
    if ((r.flags ?? []).length) continue; // already out of retrieval
    if (reviewed.has(`${stem}\t${r.label}`)) continue;
    const checks: string[] = [];
    let score = 0;
    const answer = answerPart(r.mark_scheme);
    // A tick-box question with its options stored is an ordinary MCQ: the scheme
    // prints the chosen option. Without options, the ticks are the answer.
    const drawn = DRAWN.test(String(r.prompt ?? "")) &&
      !(/tick/i.test(String(r.prompt)) && Array.isArray(r.options) && r.options.length >= 2);

    if (/^\s*guidance:/i.test(String(r.mark_scheme ?? ""))) { checks.push("guidance_only"); score += 5; }

    // A drawn answer (lines, ticks, a filled table) is never in the PDF text, so a
    // miss there says nothing; drawn_answer sends it to be read off the page.
    if (msOk && !drawn && !isLetterAnswer(r.mark_scheme)) {
      const m = cover(answer, ms);
      // A reflowed scheme (a sum laid out differently, guidance moved between
      // answers) keeps some text in order and all its words. Words alone are not
      // enough: any scheme in the subject shares vocabulary with the PDF.
      if (m !== null && m < 0.5 && (m >= 0.15 || terse(answer) ? words(answer, msWords) < 0.9 : true)) { checks.push(`ms_not_in_pdf(${m.toFixed(2)})`); score += m < 0.2 ? 4 : 2; }
    }

    if (qpOk) {
      const p = cover(r.prompt, qp), c = r.shared_context ? cover(r.shared_context, qp) : null;
      const worst = Math.min(p ?? 1, c ?? 1);
      const vocab = Math.min(words(r.prompt, qpWords), words(r.shared_context, qpWords));
      if (worst < 0.5 && vocab < 0.9) { checks.push(`prompt_not_in_qp(${worst.toFixed(2)})`); score += worst < 0.3 ? 4 : 2; }
    }

    const twins = byScheme.get(norm(r.mark_scheme))?.filter((l) => l !== r.label) ?? [];
    if (twins.length) { checks.push(`sibling_ms(${twins.join(",")})`); score += 3; }

    if ((r.marks ?? 0) >= 2 && norm(String(r.mark_scheme ?? "").replace(/guidance:/gi, "")).length < 12 && !isLetterAnswer(r.mark_scheme)) { checks.push("thin_ms"); score += 1; }

    if (drawn) { checks.push("drawn_answer"); score += 2; }

    if (score) hits.push({
      stem, label: r.label, marks: r.marks ?? null, score, checks,
      prompt: String(r.prompt ?? "").replace(/\s+/g, " ").slice(0, 160),
      scheme: String(r.mark_scheme ?? "").replace(/\s+/g, " ").slice(0, 200),
    });
  }
}

hits.sort((a, b) => b.score - a.score || a.stem.localeCompare(b.stem) || a.label.localeCompare(b.label));

const outDir = join(PAPERS, "triage");
mkdirSync(outDir, { recursive: true });
const name = scope.length ? scope.join("-") : "all";
const tsv = ["score\tstem\tlabel\tmarks\tchecks\tprompt\tscheme\treviewed\tverdict"]
  .concat(hits.map((h) => [h.score, h.stem, h.label, h.marks ?? "", h.checks.join(" "), h.prompt, h.scheme, "", ""].join("\t")))
  .join("\n");
writeFileSync(join(outDir, `${name}.tsv`), tsv + "\n");

const count = (k: string) => hits.filter((h) => h.checks.some((c) => c.startsWith(k))).length;
console.log(`${stems.length} papers, ${total} rows → ${hits.length} to review (${((100 * hits.length) / Math.max(total, 1)).toFixed(1)}%)`);
console.log(`  score ≥ 4 (look first): ${hits.filter((h) => h.score >= 4).length}`);
for (const k of ["guidance_only", "ms_not_in_pdf", "prompt_not_in_qp", "sibling_ms", "thin_ms", "drawn_answer"]) console.log(`  ${k.padEnd(17)} ${count(k)}`);
if (unchecked.length) console.log(`not text-checkable (${unchecked.length}): ${process.argv.includes("--verbose") ? "\n  " + unchecked.join("\n  ") : unchecked.slice(0, 3).join("; ") + (unchecked.length > 3 ? "; … (--verbose for all)" : "")}`);
console.log(`→ ${join(outDir, `${name}.tsv`)}`);
