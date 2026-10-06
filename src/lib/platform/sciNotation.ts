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
 * - a formula is made only of real element symbols ("KS3" and "AO1" are not),
 *   bar the stand-ins questions use for an unknown element (X₂CO₃, MSO₄);
 * - a small 1 is never written, so "H1N1" and "F1" are labels, not formulas,
 *   and so is anything made only of letters used that way ("P1V1 = P2V2");
 * - one element with a number ("B2", "Y11") is a formula only when it is a
 *   common molecule (Cl₂, O₂, C₆₀), or when the element is plainly being used
 *   as chemistry nearby: beside Cl₂, the wrong answer "Cl3" reads Cl₃ too, so
 *   the options don't give the right one away, but in physics "I2 = P / R"
 *   is a current squared, not iodine;
 * - a code such as "OCR C6.2b" is a code, and a dash at both ends of a
 *   repeat unit (–CH₂–CHCl–) is a bond, not a charge;
 * - lower-case text ("x2", "v2") is algebra or a label, so it needs a ^ to
 *   become a power.
 */

// prettier-ignore
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "–": "₋", "=": "₌", "(": "₍", ")": "₎", n: "ₙ", x: "ₓ", r: "ᵣ",
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

/** A small figure's ordinary character, with the minus typed as a hyphen. */
const plainOf = (c: string) => (PLAIN[c] === "−" ? "-" : (PLAIN[c] ?? c));

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

/**
 * One-element molecules that read as chemistry on their own. Others (I2, F2,
 * P4, S8, At2) need chemistry nearby: "I2 = P / R" is physics.
 */
// prettier-ignore
const MOLECULES = new Set(["H2", "N2", "O2", "O3", "Cl2", "Br2", "C60", "C70"]);

/** Words that make an element chemistry, so "iodine, I2" reads I₂. */
const ELEMENT_WORDS: [RegExp, string[]][] = [
  [/\biodine\b/i, ["I"]],
  [/\bfluorine\b/i, ["F"]],
  [/\bchlorine\b/i, ["Cl"]],
  [/\bbromine\b/i, ["Br"]],
  [/\bastatine\b/i, ["At"]],
  [/\bhalogens?\b/i, ["F", "Cl", "Br", "I", "At"]],
  [/\bphosphorus\b/i, ["P"]],
  [/\bsulfur|\bsulphur/i, ["S"]],
];

/** Letters questions use for an unknown element: always X, Y and Z ... */
const STAND_INS = new Set(["X", "Y", "Z"]);
/** ... and any capital beside a familiar group: MSO4, A(NO3)2, M3PO4. */
const GROUPS = /SO4|SO3|CO3|HCO3|NO3|NO2|PO4|\(OH\)/;

/** Ions written with a bare sign (Na+, Cl-). Others need a figure (Mg2+), so a "B+" grade stays. */
const SIMPLE_IONS = new Set(["H", "Li", "Na", "K", "Rb", "Cs", "Ag", "Cu", "F", "Cl", "Br", "I"]);

/** Built from element symbols but never a formula: key stages, sun cream, ratings, F2F. */
const NOT_FORMULAS = /^(KS|SPF|IP|PS|BS|ISO)\d|^([A-Z])2\2$/;

/** A count in a formula: never 1, never a leading 0. */
const okCount = (d: string) => d !== "1" && !d.startsWith("0");

/**
 * The formula with its counts made small, or null when the token is not a
 * formula. Counts follow an element or a closing bracket: Al2(SO4)3.
 */
function parseFormula(core: string): {
  out: string;
  elements: Set<string>;
  counts: number;
  brackets: boolean;
  standIns: number;
} | null {
  const anyStandIn = GROUPS.test(core);
  let standIns = 0;
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
      const standIn = sym.length === 1 && (STAND_INS.has(sym) || anyStandIn);
      if (!ELEMENTS.has(sym) && !standIn) return null;
      // "BB", "HH": a symbol is never repeated without a count between,
      // bar the two oxygens of an acid or ester (CH3COOH).
      if (sym === prev && sym !== "O") return null;
      out += sym;
      if (ELEMENTS.has(sym)) elements.add(sym);
      else standIns++;
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
  // A stand-in needs company: "X2" alone is a label.
  if (standIns && elements.size + standIns < 2 && !brackets) return null;
  return depth === 0 && elements.size + standIns
    ? { out, elements, counts, brackets, standIns }
    : null;
}

/** An ion's charge from the figures typed after it: "2+" -> ²⁺, "-" -> ⁻. */
const charge = (digits: string, sign: string) => toSup(digits + (sign === "+" ? "+" : "-"));

/**
 * One formula-shaped token, with the charge sign typed straight after it if
 * there is one. Returns the token unchanged when it is not a formula.
 */
type Clues = {
  /** Letters used as numbered labels (F1 and F2), never formulas. */
  labels: Set<string>;
  /** Elements written in a formula or ion somewhere nearby. */
  chemical: Set<string>;
};

function formatToken(token: string, sign: string, clues: Clues, seen?: Set<string>): string {
  // What was typed, for every way out that changes nothing. `sign` itself may
  // move into the tail below, when a bracket comes between it and the formula.
  const asTyped = token + sign;
  if (NOT_FORMULAS.test(token)) return asTyped;
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
  // A state symbol still to be filled in: "H2O(___", "ZnCl2( ".
  const unfinished = /\([^A-Z()]*$/.exec(core);
  if (unfinished && opens(core) > closes(core)) {
    tail = unfinished[0] + tail;
    core = core.slice(0, -unfinished[0].length);
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
  // State symbol, NaCl(aq) or a blank H2O(x), a mark "(1)", or a polymer's
  // n, (C2H4)n: anything in brackets with no capital is not formula.
  const state = /(\([^A-Z()[\]]*\)|(?<=\))n)$/.exec(core);
  // A real state symbol says chemistry by itself: I2(g) is iodine.
  const stated = !!state && /^\((s|l|g|aq)\)$/.test(state[0]);
  if (state) {
    core = core.slice(0, -state[0].length);
    tail = state[0] + tail;
  }
  // The number of formula units in front stays full size: 2H2O, CuSO4.xH2O.
  const coef = /^(\d+|[xn](?=[A-Z]))?/.exec(core)![0];
  core = core.slice(coef.length);
  if (!core) return asTyped;

  const whole = (body: string) => lead + coef + body + tail;

  if (sign) {
    const trail = /\d*$/.exec(core)![0];
    const base = core.slice(0, core.length - trail.length);
    const single =
      (/^[A-Z][a-z]?$/.test(base) && ELEMENTS.has(base)) || (/^[A-Z]$/.test(base) && !!trail);
    if (single) {
      // Mg2+, O2-, Na+, and a stand-in's X2+: the figures are the charge.
      if (trail.length > 1 || trail === "0" || trail === "1") return asTyped;
      if (!trail && !SIMPLE_IONS.has(base) && !clues.chemical.has(base)) return asTyped;
      seen?.add(base);
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
    if (!f) return asTyped;
    f.elements.forEach((e) => seen?.add(e));
    return whole(f.out + charge(size, sign));
  }

  const f = parseFormula(core);
  if (!f) return asTyped;
  if (f.counts === 0) {
    // NaCl, HCl, HI(g): no figures to change, but chemistry all the same.
    // All-capital words (IF, NO) are not counted.
    if (f.elements.size > 1 && (stated || /[a-z]/.test(core)))
      f.elements.forEach((e) => seen?.add(e));
    return asTyped;
  }
  // F2 beside F1, or P2V2 beside P1V1: labels, not formulas.
  if (f.elements.size && [...f.elements].every((e) => clues.labels.has(e))) return asTyped;
  if (f.elements.size === 1 && !f.brackets && !f.standIns) {
    const [el] = f.elements;
    if (!MOLECULES.has(core) && !clues.chemical.has(el) && !stated) return asTyped;
  }
  f.elements.forEach((e) => seen?.add(e));
  return whole(f.out);
}

const UNIT_ROOTS = "kg|g|mg|mol|m|cm|dm|mm|km|nm|μm|s|ms|min|K|J|kJ|N|W|Pa|h|C|V|A|Hz";
const LENGTHS = "m|cm|dm|mm|km|nm|μm";
const SIGN = "[−–-]";

const FORMULA_TOKEN = /(?<![A-Za-z0-9])([A-Za-z0-9()[\]]+)([+−–-]?)(?![A-Za-z0-9])/g;

/** What the text around a formula says about it: see `Clues`. */
function cluesFrom(text: string): Clues {
  // F1, and both letters of P1V1.
  const labels = new Set(
    [...text.matchAll(/(?<![A-Za-z])([A-Z][a-z]?)1(?![0-9a-z])/g)].map((m) => m[1]),
  );
  // Already written properly (Cl₂, Fe³⁺), or typed in a formula we are sure of.
  const chemical = new Set(
    [...text.matchAll(/([A-Z][a-z]?)[₀-₉⁰¹²³⁴-⁹⁺⁻]/g)]
      .map((m) => m[1])
      .filter((e) => ELEMENTS.has(e)),
  );
  for (const [word, els] of ELEMENT_WORDS) if (word.test(text)) els.forEach((e) => chemical.add(e));
  const sure: Clues = { labels, chemical: new Set() };
  for (const m of text.matchAll(FORMULA_TOKEN))
    if (/[A-Z]/.test(m[1])) formatToken(m[1], m[2], sure, chemical);
  return { labels, chemical };
}

/**
 * Rewrites typed notation (H2O, Mg2+, cm3, 10^-3) into its proper form. Safe
 * to run twice.
 *
 * `context` is text shown alongside (a question beside its options), read
 * only for clues: see `toSciNotationTogether`.
 */
export function toSciNotation(text: string, context = ""): string {
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

  // General formulas: CnH2n+2, CnH2n+1OH, CxH14.
  s = s.replace(
    /(?<![A-Za-z0-9])C([nx])H(2[nx](?:[+−–-][1-4])?|[nx]|\d+)(?![a-z0-9])/g,
    (_m, c: string, h: string) => `C${toSub(c)}H${toSub(h)}`,
  );

  // Formulas, ions and electrons.
  const clues = cluesFrom(context ? `${s}\n${context}` : s);
  s = s.replace(FORMULA_TOKEN, (m, token: string, sign: string, at: number, all: string) => {
    if (/^\d*e$/.test(token) && sign && sign !== "+") return token + toSup("-");
    if (!/[A-Z]/.test(token)) return m;
    // A specification code, OCR C6.2b or P4.1a.
    if (/^[A-Z][a-z]?\d+$/.test(token) && /^\.\d/.test(all.slice(at + m.length))) return m;
    // A dash before the formula makes the one after it a bond: –CH₂–CHCl–.
    if (sign && sign !== "+") {
      let i = at;
      while (i > 0 && /[A-Za-z0-9()[\]₀-₉ₙₓ⁰¹²³⁴-⁹⁺⁻]/.test(all[i - 1])) i--;
      if (/[-–—=≡]/.test(all[i - 1] ?? "")) return formatToken(token, "", clues) + sign;
    }
    return formatToken(token, sign, clues);
  });

  // A charge typed after a space: SO₄ 2-, Al 3+.
  s = s.replace(
    /(?<=[₀-₉]|(?<![A-Za-z0-9])(?:Al|Mg|Fe|Cu|Zn|Ca|Ba|Pb|Sr|Ni|Cr|Mn|Sn|Hg|Ag|Li|Na)) ([1-4])([+−–-])(?=[\s,.;:)\]]|$)/g,
    (_m, d: string, sign: string) => charge(d, sign),
  );

  // Units. cm3 and dm3 are never anything else.
  s = s.replace(
    new RegExp(`(?<![A-Za-z0-9])(cm|dm|mm|km|nm|μm)([23])(?![A-Za-z0-9])`, "g"),
    (_m, u: string, p: string) => u + toSup(p),
  );
  // m2, s2, m-3 and s-1 only right after a number, a blank, a / or another
  // unit: 5 m2, 10⁴ m3, ___ m2, m / s2, kg m-3, cm³ s–1, cm³.min-1.
  const after = `(?<=[\\d⁰¹²³⁴-⁹]\\s?|_\\s?|\\/\\s?|(?:^|[\\s(/.·])(?:${UNIT_ROOTS})(?:[⁰¹²³⁴-⁹⁻]+|${SIGN}?\\d)?[\\s.·])`;
  s = s.replace(
    new RegExp(`${after}(${LENGTHS}|s)([23])(?![A-Za-z0-9])`, "g"),
    (_m, u: string, p: string) => u + toSup(p),
  );
  s = s.replace(
    new RegExp(`${after}(${UNIT_ROOTS})(${SIGN}[1-4])(?![A-Za-z0-9])`, "g"),
    (_m, u: string, p: string) => u + toSup(p),
  );
  // A unit alone in brackets, as a table heading: (s-1), (m2).
  s = s.replace(
    /(?<=\()(s|ms|min|h|m|cm|dm|mm|km|g|kg|mol)([−–-][1-4]|(?<=\(m|\(s)[23])(?=\))/g,
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

/**
 * Texts shown together (a question, its options and explanation) in proper
 * notation, each read with the others as context, so every option is
 * written the same way.
 */
export function toSciNotationTogether(texts: string[]): string[] {
  const all = texts.join("\n");
  return texts.map((t) => toSciNotation(t, all));
}

export type SciRun = { text: string; kind: "text" | "sub" | "sup" };

/**
 * Text split into ordinary, subscript and superscript runs, each with
 * ordinary characters, so the page can draw the small ones in the site's own
 * font (the web fonts carry no subscript figures).
 */
export function sciRuns(text: string, context = ""): SciRun[] {
  const runs: SciRun[] = [];
  for (const ch of toSciNotation(text ?? "", context)) {
    const kind = SUB_CHARS.has(ch) ? "sub" : SUP_CHARS.has(ch) ? "sup" : "text";
    const plain = kind === "text" ? ch : PLAIN[ch];
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += plain;
    else runs.push({ text: plain, kind });
  }
  return runs;
}

/**
 * x₂ or x² pressed with text selected: the selection made small, or made
 * ordinary again if it already was. Characters with no small form (most
 * letters) stay as they are.
 */
export function toggleScript(
  value: string,
  start: number,
  end: number,
  kind: "sub" | "sup",
): { value: string; start: number; end: number } {
  if (start === end) return { value, start, end };
  const map = kind === "sub" ? SUB : SUP;
  const target = kind === "sub" ? SUB_CHARS : SUP_CHARS;
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

/**
 * Typing while x₂ or x² is held on, as in a word processor: what was just
 * typed comes out small where it has a small form (figures, + and −, n).
 *
 * A space or a new line lets go, since a formula never has one: it and
 * anything after it stay ordinary, and `done` says the button is off again.
 *
 * `before` is the text before the edit, `after` the text after it, and
 * `caret` where the cursor ended up, just past what was typed.
 */
export function scriptTyped(
  before: string,
  after: string,
  caret: number,
  kind: "sub" | "sup",
): { value: string; done: boolean } {
  const map = kind === "sub" ? SUB : SUP;
  // What follows the cursor is untouched by typing, so the typed text runs
  // from where the two versions first differ up to the cursor.
  const tail = after.length - caret;
  if (tail < 0 || before.length < tail || before.slice(before.length - tail) !== after.slice(caret))
    return { value: after, done: false };
  let from = 0;
  const limit = Math.min(caret, before.length - tail);
  while (from < limit && before[from] === after[from]) from++;
  const typed = after.slice(from, caret);
  let out = "";
  let done = false;
  for (const [i, c] of [...typed].entries()) {
    if (/\s/.test(c)) {
      out += [...typed].slice(i).join("");
      done = true;
      break;
    }
    out += map[c] ?? c;
  }
  return { value: after.slice(0, from) + out + after.slice(caret), done };
}
