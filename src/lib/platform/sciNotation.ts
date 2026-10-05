/**
 * Scientific notation: subscripts and superscripts in chemical formulas,
 * ions, units and powers of ten.
 *
 * Questions, answers and mark schemes are stored as plain text, with the
 * small figures written as Unicode characters (H₂O, Mg²⁺, cm³, 10⁻³). That
 * text stays readable wherever it goes: the page, the AI marker, an email.
 *
 * Text often arrives without them. Past-paper text is copied out of PDFs,
 * which drops the small figures ("H2O"); students type on a keyboard; a model
 * copies the style of its examples. `toSciNotation` turns that typed form into
 * the proper one. It runs on everything a generator writes, before it is
 * saved, and on everything the site shows, so older text reads properly too.
 *
 * It only changes what it can recognise for certain, so a word that merely
 * looks like a formula is left alone:
 * - a formula is made only of real element symbols ("KS3" and "AO1" are not);
 * - a small 1 is never written, so "H1N1" and "F1" are labels, not formulas;
 * - one element with a number ("B2", "Y11") is a formula only when it is a
 *   real molecule (Cl₂, O₂, C₆₀);
 * - lower-case text ("x2", "v2") is algebra or a label, so it needs a ^ to
 *   become a power.
 */

// prettier-ignore
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "–": "₋", "=": "₌", "(": "₍", ")": "₎",
};

// prettier-ignore
const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "–": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};

/** Small figure back to its ordinary character (the minus as a true minus). */
const PLAIN: Record<string, string> = {};
for (const [k, v] of Object.entries(SUB)) if (k !== "−" && k !== "–") PLAIN[v] = k;
for (const [k, v] of Object.entries(SUP)) if (k !== "−" && k !== "–") PLAIN[v] = k;
PLAIN["⁻"] = "−";
PLAIN["₋"] = "−";

const SUB_CHARS = new Set(Object.values(SUB));
const SUP_CHARS = new Set(Object.values(SUP));

export const toSub = (s: string) => [...s].map((c) => SUB[c] ?? c).join("");
export const toSup = (s: string) => [...s].map((c) => SUP[c] ?? c).join("");

const ELEMENTS = new Set(
  (
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se " +
    "Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy " +
    "Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf " +
    "Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og"
  ).split(" "),
);

/** Elements that exist as molecules, the only one-element formulas written with a number. */
// prettier-ignore
const MOLECULES = new Set(["H2", "N2", "O2", "O3", "F2", "Cl2", "Br2", "I2", "P4", "S8", "C60", "C70"]);

/** Ions written with a bare sign (Na+, Cl-). Others need a figure (Mg2+), so a "B+" grade stays. */
const SIMPLE_IONS = new Set(["H", "Li", "Na", "K", "Rb", "Cs", "Ag", "Cu", "F", "Cl", "Br", "I"]);

/** Built from element symbols but never a formula: key stages, sun cream, ratings. */
const NOT_FORMULAS = /^(KS|SPF|IP|PS|BS|ISO)\d/;

/** A count in a formula: never 1, never a leading 0. */
const okCount = (d: string) => d !== "1" && !d.startsWith("0");

/**
 * The formula with its counts made small, or null when the token is not a
 * formula. Counts follow an element or a closing bracket: Al2(SO4)3.
 */
function parseFormula(
  core: string,
): { out: string; elements: Set<string>; counts: number; brackets: boolean } | null {
  let out = "";
  let depth = 0;
  let counts = 0;
  let brackets = false;
  let prev = "";
  const elements = new Set<string>();
  let i = 0;
  const readCount = () => {
    const m = /^\d+/.exec(core.slice(i));
    if (!m) return "";
    i += m[0].length;
    return m[0];
  };
  while (i < core.length) {
    const c = core[i];
    if (c === "(" || c === "[") {
      depth++;
      brackets = true;
      out += c;
      prev = "";
      i++;
    } else if (c === ")" || c === "]") {
      if (depth === 0) return null;
      depth--;
      out += c;
      i++;
      const d = readCount();
      if (d) {
        if (!okCount(d)) return null;
        out += toSub(d);
        counts++;
      }
      prev = "";
    } else if (/[A-Z]/.test(c)) {
      let sym = c;
      if (/[a-z]/.test(core[i + 1] ?? "")) sym = c + core[i + 1];
      if (!ELEMENTS.has(sym)) return null;
      // "BB", "HH": a symbol is never repeated without a count between.
      if (sym === prev) return null;
      out += sym;
      elements.add(sym);
      i += sym.length;
      const d = readCount();
      if (d) {
        if (!okCount(d)) return null;
        out += toSub(d);
        counts++;
        prev = "";
      } else prev = sym;
    } else return null;
  }
  return depth === 0 && elements.size ? { out, elements, counts, brackets } : null;
}

/** An ion's charge from the figures typed after it: "2+" -> ²⁺, "-" -> ⁻. */
const charge = (digits: string, sign: string) => toSup(digits + (sign === "+" ? "+" : "-"));

/**
 * One formula-shaped token, with the charge sign typed straight after it if
 * there is one. Returns the token unchanged when it is not a formula.
 */
function formatToken(token: string, sign: string, labels: Set<string>): string {
  if (NOT_FORMULAS.test(token)) return token + sign;
  // Brackets around the formula, not part of it: "(NH3,", "CO2)", "[Fe2O3]".
  const opens = (t: string) => (t.match(/[([]/g) ?? []).length;
  const closes = (t: string) => (t.match(/[)\]]/g) ?? []).length;
  const balanced = (t: string) => {
    let depth = 0;
    for (const c of t) {
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      if (depth < 0) return false;
    }
    return depth === 0;
  };
  let lead = "";
  let tail = "";
  let core = token;
  while (/^[([]/.test(core) && opens(core) > closes(core)) {
    lead += core[0];
    core = core.slice(1);
  }
  while (/[)\]]$/.test(core) && closes(core) > opens(core)) {
    tail = core[core.length - 1] + tail;
    core = core.slice(0, -1);
  }
  while (/^[([].*[)\]]$/.test(core) && balanced(core.slice(1, -1))) {
    lead += core[0];
    tail = core[core.length - 1] + tail;
    core = core.slice(1, -1);
  }
  // A charge only belongs to the formula when nothing comes between them.
  if (tail) {
    tail += sign;
    sign = "";
  }
  // State symbol, NaCl(aq), or a polymer's n, (C2H4)n.
  const state = /(\((s|l|g|aq)\)|(?<=\))n)$/.exec(core);
  if (state) {
    core = core.slice(0, -state[0].length);
    tail = state[0] + tail;
  }
  // The number of formula units in front stays full size: 2H2O, CuSO4.xH2O.
  const coef = /^(\d+|[xn](?=[A-Z]))?/.exec(core)![0];
  core = core.slice(coef.length);
  if (!core) return token + sign;

  const whole = (body: string) => lead + coef + body + tail;

  if (sign) {
    const trail = /\d*$/.exec(core)![0];
    const base = core.slice(0, core.length - trail.length);
    const single = /^[A-Z][a-z]?$/.test(base) && ELEMENTS.has(base);
    if (single) {
      // Mg2+, O2-, Na+: the figures are the charge.
      if (trail.length > 1 || trail === "0" || trail === "1") return token + sign;
      if (!trail && !SIMPLE_IONS.has(base)) return token + sign;
      return whole(base + charge(trail, sign));
    }
    // NO3-, NH4+, OH-: the figures are a count, the sign the charge.
    // SO42-, PO43-: the last figure is the charge.
    let count = trail;
    let size = "";
    if (trail.length >= 2 && "23".includes(trail[trail.length - 1])) {
      count = trail.slice(0, -1);
      size = trail[trail.length - 1];
    }
    const f = parseFormula(base + count);
    if (!f) return token + sign;
    return whole(f.out + charge(size, sign));
  }

  const f = parseFormula(core);
  if (!f || f.counts === 0) return token;
  if (f.elements.size === 1 && !f.brackets) {
    // F2 beside F1 is the second of two labels, not fluorine.
    if (!MOLECULES.has(core) || labels.has([...f.elements][0])) return token;
  }
  return whole(f.out);
}

const UNIT_ROOTS = "kg|g|mg|mol|m|cm|dm|mm|km|nm|μm|s|K|J|kJ|N|W|Pa|h|C|V|A|Hz";
const LENGTHS = "m|cm|dm|mm|km|nm|μm";
const SIGN = "[−–-]";

/** Rewrites typed notation (H2O, Mg2+, cm3, 10^-3) into its proper form. Safe to run twice. */
export function toSciNotation(text: string): string {
  if (!text) return text;
  let s = text;

  // Arrows first, so "O2->" is never read as an ion.
  s = s.replace(/\s*<=+>\s*/g, " ⇌ ").replace(/\s*-+>\s*/g, " → ");

  // Anything written with ^ is a power or charge: x^2, 10^-3, SO4^2-, Fe^{3+}.
  s = s.replace(
    /(?<=[A-Za-z0-9)\]])\^(?:\{([+−–-]?\d*[+−–-]?)\}|([+−–-]?\d+[+−–-]?|[+−–-]))/g,
    (m, braced: string | undefined, bare: string | undefined) => {
      const body = braced ?? bare ?? "";
      return body ? toSup(body) : m;
    },
  );

  // Formulas, ions and electrons.
  const labels = new Set(
    [...s.matchAll(/(?<![A-Za-z0-9])([A-Z][a-z]?)1(?![A-Za-z0-9])/g)].map((m) => m[1]),
  );
  s = s.replace(
    /(?<![A-Za-z0-9])([A-Za-z0-9()[\]]+)([+−–-]?)(?![A-Za-z0-9])/g,
    (m, token: string, sign: string) => {
      if (/^\d*e$/.test(token) && sign && sign !== "+") return token + toSup("-");
      if (!/[A-Z]/.test(token)) return m;
      return formatToken(token, sign, labels);
    },
  );

  // Units. cm3 and dm3 are never anything else.
  s = s.replace(
    new RegExp(`(?<![A-Za-z0-9])(cm|dm|mm|km|nm|μm)([23])(?![A-Za-z0-9])`, "g"),
    (_m, u: string, p: string) => u + toSup(p),
  );
  // m2, s2, m-3 and s-1 only right after a number, a / or another unit: 5 m2, m/s2, kg m-3.
  const after = `(?<=\\d\\s?|\\/|(?:^|[\\s(/])(?:${UNIT_ROOTS})(?:${SIGN}?\\d)?\\s)`;
  s = s.replace(
    new RegExp(`${after}(${LENGTHS}|s)([23])(?![A-Za-z0-9])`, "g"),
    (_m, u: string, p: string) => u + toSup(p),
  );
  s = s.replace(
    new RegExp(`${after}(${UNIT_ROOTS})(${SIGN}[1-4])(?![A-Za-z0-9])`, "g"),
    (_m, u: string, p: string) => u + toSup(p),
  );

  // Standard form: 3.0 x 10-3, 3.0 x 10⁸.
  s = s.replace(
    /(\d)\s?[x×]\s?10([−–-]\d+)(?![\d.])/g,
    (_m, d: string, p: string) => `${d} × 10${toSup(p)}`,
  );
  s = s.replace(/(\d)\s?x\s?10(?=[⁰¹²³⁴⁵⁶⁷⁸⁹⁻])/g, "$1 × 10");

  // Degrees Celsius typed with a letter o: 25 oC.
  s = s.replace(/(\d)\s?[oº˚]C(?![A-Za-z])/g, "$1 °C");

  return s;
}

export type SciRun = { text: string; kind: "text" | "sub" | "sup" };

/**
 * Text split into ordinary, subscript and superscript runs, each with
 * ordinary characters, so the page can draw the small ones in the site's own
 * font (the web fonts carry no subscript figures).
 */
export function sciRuns(text: string): SciRun[] {
  const runs: SciRun[] = [];
  for (const ch of toSciNotation(text ?? "")) {
    const kind = SUB_CHARS.has(ch) ? "sub" : SUP_CHARS.has(ch) ? "sup" : "text";
    const plain = kind === "text" ? ch : PLAIN[ch];
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += plain;
    else runs.push({ text: plain, kind });
  }
  return runs;
}

/**
 * The subscript/superscript buttons on an answer box. Makes the selection
 * small, or, with nothing selected, the figures just before the cursor
 * ("H2|" -> "H₂|"). Pressing again makes them ordinary.
 */
export function toggleScript(
  value: string,
  start: number,
  end: number,
  kind: "sub" | "sup",
): { value: string; start: number; end: number } {
  const map = kind === "sub" ? SUB : SUP;
  const target = kind === "sub" ? SUB_CHARS : SUP_CHARS;
  const plainOf = (c: string) => (PLAIN[c] === "−" ? "-" : (PLAIN[c] ?? c));
  if (start === end) {
    // The figures (and a charge sign) typed just before the cursor.
    let i = start;
    const takes = (c: string) =>
      /[0-9]/.test(c) ||
      (kind === "sup" && /[+−–-]/.test(c)) ||
      SUB_CHARS.has(c) ||
      SUP_CHARS.has(c);
    while (i > 0 && takes(value[i - 1])) i--;
    if (i === start) return { value, start, end };
    start = i;
  }
  const chosen = value.slice(start, end);
  const already = [...chosen].every((c) => target.has(c) || !(plainOf(c) in map));
  const swapped = [...chosen]
    .map((c) => {
      const p = plainOf(c);
      return already ? p : (map[p] ?? c);
    })
    .join("");
  return {
    value: value.slice(0, start) + swapped + value.slice(end),
    start,
    end: start + swapped.length,
  };
}
