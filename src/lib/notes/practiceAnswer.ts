/**
 * Reads a student's typed answer in a "Practise the calculation" box.
 *
 * Forgiving about how a number is written, so a right answer is never marked
 * wrong for its punctuation: a typographic minus or dash (from a phone, or
 * pasted) counts as a minus, spaces are ignored, a comma before exactly three
 * digits groups thousands ("4,200") and a lone comma otherwise is a decimal
 * point ("4,2" or "0,500", as in much of Europe). NaN when it isn't a number.
 */
export function parseAnswer(text: string): number {
  let s = text
    .trim()
    .replace(/^[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/, "-")
    .replace(/[\s\u00A0\u2009\u202F]/g, "");
  if (!s) return NaN;
  const commas = (s.match(/,/g) ?? []).length;
  const decimalComma =
    commas === 1 && !s.includes(".") && (!/,\d{3}$/.test(s) || /^[-+]?0,/.test(s));
  s = decimalComma ? s.replace(",", ".") : s.replace(/,/g, "");
  return Number(s);
}

/**
 * The answer with its sign flipped, for the ± button: a phone's number pad has
 * no minus key, and an energy change or a potential can be negative.
 */
export function flipSign(text: string): string {
  const s = text.trimStart();
  return /^[-\u2212\u2012\u2013\u2014\uFE63\uFF0D]/.test(s) ? s.slice(1) : `-${s}`;
}
