/**
 * Reads a student's typed answer in a "Practise the calculation" box: every
 * number it could fairly mean, or none when it isn't a number.
 *
 * Forgiving about how a number is written, so a right answer is never marked
 * wrong for its punctuation: a typographic minus or dash (from a phone, or
 * pasted) counts as a minus, spaces are ignored, commas before groups of three
 * digits group thousands ("1,234,567") and a lone comma otherwise is a decimal
 * point ("4,2" or "0,500", as in much of Europe). A lone comma before exactly
 * three digits could be either ("1,250" is 1250, or 1.250 typed on a phone that
 * writes a decimal comma), so both readings come back.
 */
export function answerReadings(text: string): number[] {
  const s = text
    .trim()
    .replace(/^[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/, "-")
    .replace(/[\s\u00A0\u2009\u202F]/g, "");
  if (!s) return [];
  const commas = (s.match(/,/g) ?? []).length;
  const readings: number[] = [];
  if (commas === 1 && !s.includes(".")) {
    readings.push(Number(s.replace(",", ".")));
    if (/,\d{3}$/.test(s) && !/^[-+]?0,/.test(s)) readings.push(Number(s.replace(",", "")));
  } else {
    readings.push(Number(s.replace(/,/g, "")));
  }
  return readings.filter(Number.isFinite);
}

/**
 * The answer with its sign flipped, for the ± button: a phone's number pad has
 * no minus key, and an energy change or a potential can be negative.
 */
export function flipSign(text: string): string {
  const s = text.trimStart();
  return /^[-\u2212\u2012\u2013\u2014\uFE63\uFF0D]/.test(s) ? s.slice(1) : `-${s}`;
}
