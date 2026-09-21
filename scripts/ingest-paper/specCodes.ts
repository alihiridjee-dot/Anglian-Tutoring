/**
 * What the two loaders must agree on: which paper a file is, and which spec
 * point a tag like `1.6` means. load-exemplars.ts and load-tags.ts both import
 * this, so tagging a question on the way in and correcting it later can never
 * read the same file or the same code differently.
 */

/**
 * The paper a file holds, from the name the renamer gives it:
 *
 *     aqa-biology-gcse-2018-p1F            tier F
 *     edexcel-biology-igcse-2019-p1BR      Edexcel iGCSE: subject letter, then R
 *     oxford_aqa-physics-igcse-2024-p1     no tier
 *
 * The board is a curriculum board value, so it may contain an underscore. The
 * suffix is up to two capitals because Edexcel iGCSE prints its papers as 1B
 * and 1BR, and those are two different papers, not one paper in two tiers.
 */
export const PAPER_STEM =
  /^([a-z_]+)-([a-z-]+)-(gcse|igcse|alevel)-(\d{4}|unknown)-p(\d)([A-Z]{0,2})$/;

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
