/**
 * What the two loaders must agree on: which paper a file is, and which spec
 * point a tag like `1.6` means. load-exemplars.ts and load-tags.ts both import
 * this, so tagging a question on the way in and correcting it later can never
 * read the same file or the same code differently.
 */

/**
 * The sittings a paper can belong to, as `exam_exemplars.series` stores them:
 * January, February/March, May/June (summer) and October/November (autumn).
 */
export const SERIES = ["jan", "mar", "jun", "nov"] as const;
export type Series = (typeof SERIES)[number];

/**
 * The paper a file holds, from the name the renamer gives it:
 *
 *     aqa-biology-gcse-2018-jun-p1F             tier F
 *     edexcel-biology-igcse-2019-jun-p1BR       Edexcel iGCSE: subject letter, then R
 *     oxford_aqa-physics-igcse-2024-nov-p1      no tier
 *     cambridge-physics-igcse-2024-jun-p41      Cambridge component: paper 4, variant 1
 *     aqa-biology-gcse_trilogy-2018-jun-p1F     Combined Science: Trilogy
 *
 * The board and level are curriculum values, so they may contain an
 * underscore. The sitting is part of the name because the international boards
 * set the same paper number more than once a year. The paper is up to two
 * digits because Cambridge sets each paper in variants (0625/41, /42, /43)
 * that are different papers. The suffix is up to two capitals because Edexcel
 * iGCSE prints its papers as 1B and 1BR, and those are two different papers,
 * not one paper in two tiers.
 */
export const PAPER_STEM =
  /^([a-z_]+)-([a-z-]+)-(gcse|gcse_trilogy|igcse|alevel)-(\d{4}|unknown)-(jan|mar|jun|nov|unknown)-p(\d{1,2})([A-Z]{0,2})$/;

export type Paper = {
  board: string;
  subject: string;
  level: string;
  year: string | null;
  /** Null when the renamer could not read the sitting off the paper. */
  series: Series | null;
  paper: string;
  tier: string | null;
};

const isSeries = (s: string): s is Series => (SERIES as readonly string[]).includes(s);

/** A paper's identity from its filename stem, or null if the name isn't one the renamer gives. */
export function parsePaperStem(stem: string): Paper | null {
  const m = stem.match(PAPER_STEM);
  if (!m) return null;
  const [, board, subject, level, year, series, paper, tier] = m;
  return {
    board,
    subject,
    level,
    year: year === "unknown" ? null : year,
    series: isSeries(series) ? series : null,
    paper,
    tier: tier || null,
  };
}

/**
 * A spec point code as a tag writes it: without the prefix, which is everything
 * before the first part containing a digit.
 *
 *     AQA 1.6 → 1.6        AQA T 4.1.1.1 → 4.1.1.1     OCR C1.1a → C1.1a
 *     IGCSE 1.2P → 1.2P    CAIE 1.1.5S → 1.1.5S        OXAQA 3.1.1a → 3.1.1a
 *
 * Reading the prefix off the curriculum, rather than keeping a table of them,
 * means a board or level added later is taggable the day its curriculum loads.
 */
export function bareCode(code: string): string {
  const parts = code.trim().split(/\s+/);
  const first = parts.findIndex((part) => /\d/.test(part));
  return first < 0 ? parts.join(" ") : parts.slice(first).join(" ");
}

/**
 * One curriculum's spec points, keyed by bare code. Two points sharing a bare
 * code would make a tag ambiguous, and an ambiguous tag must never be resolved
 * by whichever row came back last, so that stops the load.
 */
export function indexSpecPoints(points: { id: string; code: string }[]): Map<string, string> {
  const byCode = new Map<string, string>();
  for (const { id, code } of points) {
    const bare = bareCode(code);
    const other = byCode.get(bare);
    if (other && other !== id)
      throw new Error(`Two spec points are both "${bare}" once the prefix is dropped`);
    byCode.set(bare, id);
  }
  return byCode;
}
