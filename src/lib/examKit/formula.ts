/**
 * The small notation the exam kit writes formulae in, so a booklet can be
 * copied as plain strings and still be drawn the way the paper prints it.
 *
 *   {top|bottom}  a fraction, drawn stacked (either half may hold more notation)
 *   √[x]          a square root, the bar drawn over x
 *   ^(x)          superscript: 10^(−19), e^(−λt)
 *   _(x)          subscript: m_(e), E_(k(max))
 *   ‾(x)          a bar over x: an antiparticle, ‾(ν)_(e)
 *   **x**         bold: the atom an NMR shift belongs to, RC**H**_(3)
 *
 * Everything else is written as it stands.
 */

export type FormulaNode =
  | { kind: "text"; text: string }
  | { kind: "frac"; top: FormulaNode[]; bottom: FormulaNode[] }
  | { kind: "root"; body: FormulaNode[] }
  | { kind: "sup" | "sub" | "bar" | "bold"; body: FormulaNode[] };

const OPENERS: Record<string, { close: string; kind: "root" | "sup" | "sub" | "bar" }> = {
  "√[": { close: "]", kind: "root" },
  "^(": { close: ")", kind: "sup" },
  "_(": { close: ")", kind: "sub" },
  "‾(": { close: ")", kind: "bar" },
};

/** Where the bracket opened at `from` closes, counting nested ones of its kind. */
function closing(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i;
  }
  throw new Error(`Unclosed ${open} in "${text}"`);
}

/** The `|` that splits the fraction opened at `from`, and the `}` that closes it. */
function fraction(text: string, from: number): { bar: number; end: number } {
  let depth = 0;
  let bar = -1;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "|" && depth === 1 && bar < 0) bar = i;
    else if (text[i] === "}" && --depth === 0) {
      if (bar < 0) throw new Error(`Fraction without | in "${text}"`);
      return { bar, end: i };
    }
  }
  throw new Error(`Unclosed { in "${text}"`);
}

/** Parse a formula into nodes. Throws on unbalanced notation, so tests catch a typo. */
export function parseFormula(text: string): FormulaNode[] {
  const out: FormulaNode[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ kind: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (text[i] === "{") {
      const { bar, end } = fraction(text, i);
      flush();
      out.push({
        kind: "frac",
        top: parseFormula(text.slice(i + 1, bar)),
        bottom: parseFormula(text.slice(bar + 1, end)),
      });
      i = end + 1;
    } else if (OPENERS[two]) {
      const { close, kind } = OPENERS[two];
      const end = closing(text, i + 1, two[1], close);
      flush();
      out.push({ kind, body: parseFormula(text.slice(i + 2, end)) });
      i = end + 1;
    } else if (two === "**") {
      const end = text.indexOf("**", i + 2);
      if (end < 0) throw new Error(`Unclosed ** in "${text}"`);
      flush();
      out.push({ kind: "bold", body: parseFormula(text.slice(i + 2, end)) });
      i = end + 2;
    } else if (text[i] === "}" || text[i] === "|") {
      throw new Error(`Stray ${text[i]} in "${text}"`);
    } else {
      plain += text[i];
      i++;
    }
  }
  flush();
  return out;
}

/** The formula as words and symbols with the notation taken out, for finding it by a word. */
export function plainFormula(text: string): string {
  const flat = (nodes: FormulaNode[]): string =>
    nodes
      .map((n) =>
        n.kind === "text"
          ? n.text
          : n.kind === "frac"
            ? ` ${flat(n.top)} ${flat(n.bottom)} `
            : flat(n.body),
      )
      .join("");
  try {
    return flat(parseFormula(text));
  } catch {
    return text;
  }
}
