/**
 * The student's words that earned each mark, found again in what they typed so
 * the marked sheet can draw them under the highlighter with a tick.
 *
 * The marker quotes the answer for every mark it gives, and `stageMarks`
 * (supabase/functions/mark-homework/marker.ts) keeps only the quotes it finds
 * there, folded the same way as here: case, spacing, punctuation and the form
 * of a symbol dropped. Publishing copies them onto `homework_answers.credited`.
 */
export type Credit = { quote: string; point: string; marks: number };

/** A run of the answer: plain, or the words that earned `credits[credit]`. */
export type CreditRun = { text: string; credit?: number };

/** The stored list, with anything malformed left out. */
export function parseCredited(json: unknown): Credit[] {
  if (!Array.isArray(json)) return [];
  const out: Credit[] = [];
  for (const item of json) {
    const c = item as Partial<Credit> | null;
    const marks = Number(c?.marks);
    if (typeof c?.quote !== "string" || !c.quote.trim() || !(marks > 0)) continue;
    out.push({ quote: c.quote, point: typeof c.point === "string" ? c.point : "", marks });
  }
  return out;
}

/**
 * The ticks to draw, or none. They are drawn only while they add up to the
 * mark awarded: a tutor who changed the mark has overruled them, and ticks
 * that disagree with the mark beside them would be worse than none.
 */
export function creditsToShow(json: unknown, awarded: number | null | undefined): Credit[] {
  const credits = parseCredited(json);
  if (awarded == null || awarded <= 0 || !credits.length) return [];
  const total = credits.reduce((sum, c) => sum + c.marks, 0);
  return Math.abs(total - awarded) < 1e-9 ? credits : [];
}

/** One folded character and the span of the original it came from. */
type Folded = { ch: string; from: number; to: number };

/** The marker's `fold`, a character at a time, so a match maps back to the text. */
function foldWithMap(text: string): Folded[] {
  const out: Folded[] = [];
  let i = 0;
  for (const cp of text) {
    const kept = cp
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    for (const ch of kept) out.push({ ch, from: i, to: i + cp.length });
    i += cp.length;
  }
  return out;
}

/**
 * The answer split into runs, each quote's words marked with its index. A
 * quote is looked for from the start, skipping words an earlier quote already
 * holds, so two credits for the same phrase land on its two uses. A quote
 * that cannot be found (a tutor's edit, say) is simply not drawn.
 */
export function creditRuns(answer: string, credits: Credit[]): CreditRun[] {
  const folded = foldWithMap(answer);
  const hay = folded.map((f) => f.ch).join("");
  const spans: { from: number; to: number; credit: number }[] = [];
  const taken = (from: number, to: number) => spans.some((s) => from < s.to && s.from < to);

  credits.forEach((c, credit) => {
    const needle = foldWithMap(c.quote)
      .map((f) => f.ch)
      .join("");
    if (!needle) return;
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
      const from = folded[at].from;
      const to = folded[at + needle.length - 1].to;
      if (!taken(from, to)) {
        spans.push({ from, to, credit });
        return;
      }
    }
  });

  spans.sort((a, b) => a.from - b.from);
  const runs: CreditRun[] = [];
  let i = 0;
  for (const s of spans) {
    if (s.from > i) runs.push({ text: answer.slice(i, s.from) });
    runs.push({ text: answer.slice(s.from, s.to), credit: s.credit });
    i = s.to;
  }
  if (i < answer.length) runs.push({ text: answer.slice(i) });
  return runs;
}
