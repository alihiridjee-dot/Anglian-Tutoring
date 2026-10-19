/**
 * The task sheet's calculator: reads what was keyed in and works it out.
 *
 * It behaves like the scientific calculator a student takes into the exam
 * (a Casio fx-83/85 in most schools), because that is the one whose habits
 * they are practising: ×10ˣ makes one number, so 1 ÷ 3×10⁴ divides by thirty
 * thousand; a minus sign binds looser than a power, so −2² is −4; 2π and
 * 3(4 + 1) multiply; brackets left open close themselves at the end; trig is in
 * degrees unless switched; and an answer too big or too small to read is shown
 * in standard form, as Norm 1 shows it.
 *
 * Keys write pretty symbols (×, ÷, −, √, ², ⁻¹, π, ᴇ) and a keyboard writes
 * plain ones (*, /, -, ^); both read the same.
 */

export type AngleMode = "deg" | "rad";

/** A key press that can't be worked out, worded as the calculator words it. */
export class CalcError extends Error {}

const SYNTAX = "Syntax error";
const MATHS = "Maths error";

type Token =
  | { t: "num"; v: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "post"; v: 2 | 3 | -1 }
  | { t: "fn"; v: Fn }
  | { t: "const"; v: number };

type Fn = "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "log" | "ln" | "sqrt" | "cbrt";

/** Names a student might type or a key writes, longest first so "sin⁻¹" beats "sin". */
const NAMES: [string, Fn][] = [
  ["sin⁻¹", "asin"],
  ["cos⁻¹", "acos"],
  ["tan⁻¹", "atan"],
  ["asin", "asin"],
  ["acos", "acos"],
  ["atan", "atan"],
  ["sqrt", "sqrt"],
  ["sin", "sin"],
  ["cos", "cos"],
  ["tan", "tan"],
  ["log", "log"],
  ["ln", "ln"],
  ["√", "sqrt"],
  ["∛", "cbrt"],
];

const OPS: Record<string, "+" | "-" | "*" | "/" | "^"> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "–": "-",
  "*": "*",
  "×": "*",
  "·": "*",
  "/": "/",
  "÷": "/",
  "^": "^",
};

function tokenize(src: string, ans: number): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // A number, with its ×10ˣ part if it has one: "6.02ᴇ23", "3E-4".
    const num = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (num) {
      let text = num[1];
      i += text.length;
      const exp = /^[ᴇE]([+\-−]?)(\d+)/.exec(src.slice(i));
      if (exp) {
        text += `e${exp[1] === "" || exp[1] === "+" ? "" : "-"}${exp[2]}`;
        i += exp[0].length;
      } else if (/^[ᴇE]/.test(src.slice(i))) {
        throw new CalcError(SYNTAX);
      }
      out.push({ t: "num", v: Number(text) });
      continue;
    }

    if (c in OPS) {
      out.push({ t: "op", v: OPS[c] });
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }
    if (src.startsWith("⁻¹", i)) {
      out.push({ t: "post", v: -1 });
      i += 2;
      continue;
    }
    if (c === "²" || c === "³") {
      out.push({ t: "post", v: c === "²" ? 2 : 3 });
      i++;
      continue;
    }

    const name = NAMES.find(([n]) => src.startsWith(n, i));
    if (name) {
      out.push({ t: "fn", v: name[1] });
      i += name[0].length;
      continue;
    }
    if (src.startsWith("Ans", i)) {
      out.push({ t: "const", v: ans });
      i += 3;
      continue;
    }
    if (src.startsWith("pi", i)) {
      out.push({ t: "const", v: Math.PI });
      i += 2;
      continue;
    }
    if (c === "π") {
      out.push({ t: "const", v: Math.PI });
      i++;
      continue;
    }
    if (c === "e") {
      out.push({ t: "const", v: Math.E });
      i++;
      continue;
    }
    throw new CalcError(SYNTAX);
  }
  return out;
}

/** Recursive descent over the tokens, lowest precedence first. */
function parse(tokens: Token[], mode: AngleMode): number {
  let pos = 0;
  const peek = () => tokens[pos];

  const startsOperand = (tok: Token | undefined) =>
    !!tok && (tok.t === "num" || tok.t === "lp" || tok.t === "fn" || tok.t === "const");

  function expr(): number {
    let v = term();
    for (;;) {
      const tok = peek();
      if (tok?.t === "op" && (tok.v === "+" || tok.v === "-")) {
        pos++;
        const r = term();
        v = tok.v === "+" ? v + r : v - r;
      } else return v;
    }
  }

  function term(): number {
    let v = unary();
    for (;;) {
      const tok = peek();
      if (tok?.t === "op" && (tok.v === "*" || tok.v === "/")) {
        pos++;
        const r = unary();
        if (tok.v === "/" && r === 0) throw new CalcError(MATHS);
        v = tok.v === "*" ? v * r : v / r;
      } else if (startsOperand(tok)) {
        // 2π, 3(4 + 1), 2sin(30): side by side is multiplied.
        v *= power();
      } else return v;
    }
  }

  function unary(): number {
    const tok = peek();
    if (tok?.t === "op" && (tok.v === "-" || tok.v === "+")) {
      pos++;
      const v = unary();
      return tok.v === "-" ? -v : v;
    }
    return power();
  }

  function power(): number {
    const base = postfix();
    const tok = peek();
    if (tok?.t === "op" && tok.v === "^") {
      pos++;
      // Right to left, and the power may carry its own sign: 2^-3.
      return pow(base, unary());
    }
    return base;
  }

  function postfix(): number {
    let v = primary();
    for (let tok = peek(); tok?.t === "post"; tok = peek()) {
      pos++;
      if (tok.v === -1 && v === 0) throw new CalcError(MATHS);
      v = pow(v, tok.v);
    }
    return v;
  }

  function bracketed(): number {
    // An open bracket nobody closed closes at the end, as on the calculator.
    const v = expr();
    if (peek()?.t === "rp") pos++;
    else if (pos < tokens.length) throw new CalcError(SYNTAX);
    return v;
  }

  function primary(): number {
    const tok = peek();
    if (!tok) throw new CalcError(SYNTAX);
    pos++;
    switch (tok.t) {
      case "num":
      case "const":
        return tok.v;
      case "lp":
        return bracketed();
      case "fn": {
        let arg: number;
        if (peek()?.t === "lp") {
          pos++;
          arg = bracketed();
        } else {
          arg = postfix();
        }
        return apply(tok.v, arg, mode);
      }
      default:
        throw new CalcError(SYNTAX);
    }
  }

  const v = expr();
  if (pos < tokens.length) throw new CalcError(SYNTAX);
  return v;
}

function pow(base: number, exp: number): number {
  // A cube root of a negative is real on the calculator, so a fractional power
  // with an odd denominator keeps its sign: (−8)^(1/3) = −2.
  if (base < 0 && !Number.isInteger(exp)) {
    const inv = 1 / exp;
    if (Number.isInteger(Math.round(inv)) && Math.abs(inv - Math.round(inv)) < 1e-9) {
      const n = Math.round(inv);
      if (n % 2 !== 0) return -Math.pow(-base, exp);
    }
    throw new CalcError(MATHS);
  }
  return Math.pow(base, exp);
}

const DEG = Math.PI / 180;

function apply(fn: Fn, x: number, mode: AngleMode): number {
  const toRad = (a: number) => (mode === "deg" ? a * DEG : a);
  const fromRad = (a: number) => (mode === "deg" ? a / DEG : a);
  switch (fn) {
    case "sin":
    case "cos":
    case "tan": {
      // tan 90° has no value; sin 180° is 0, not 1.2 × 10⁻¹⁶.
      if (fn === "tan" && mode === "deg" && Math.abs((((x % 180) + 180) % 180) - 90) < 1e-9)
        throw new CalcError(MATHS);
      const r = Math[fn](toRad(x));
      return Math.abs(r) < 1e-12 ? 0 : r;
    }
    case "asin":
    case "acos":
      if (x < -1 || x > 1) throw new CalcError(MATHS);
      return fromRad(Math[fn](x));
    case "atan":
      return fromRad(Math.atan(x));
    case "log":
      if (x <= 0) throw new CalcError(MATHS);
      return Math.log10(x);
    case "ln":
      if (x <= 0) throw new CalcError(MATHS);
      return Math.log(x);
    case "sqrt":
      if (x < 0) throw new CalcError(MATHS);
      return Math.sqrt(x);
    case "cbrt":
      return Math.cbrt(x);
  }
}

/**
 * Works out what was keyed in. `ans` is the last answer, read wherever "Ans"
 * appears. Throws a CalcError worded for the display.
 */
export function evaluate(src: string, mode: AngleMode = "deg", ans = 0): number {
  if (!src.trim()) throw new CalcError(SYNTAX);
  const v = parse(tokenize(src, ans), mode);
  if (!Number.isFinite(v)) throw new CalcError(MATHS);
  // Ten significant figures, as the display shows, which also clears the
  // float dust out of 0.1 + 0.2.
  return Number(v.toPrecision(10));
}

/** An answer as the display shows it: digits, and a power of ten when it needs one. */
export interface Shown {
  digits: string;
  /** Set when the answer is in standard form: digits × 10^exponent. */
  exponent: number | null;
}

/**
 * Standard form below 0.01 and from ten billion up (Norm 1), plain digits in
 * between, never more than ten significant figures.
 */
export function show(v: number): Shown {
  if (v === 0) return { digits: "0", exponent: null };
  const abs = Math.abs(v);
  if (abs < 0.01 || abs >= 1e10) {
    const [m, e] = v.toExponential(9).split("e");
    return { digits: trimZeros(m), exponent: Number(e) };
  }
  return { digits: trimZeros(String(Number(v.toPrecision(10)))), exponent: null };
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** The answer as one line of text, for a screen reader or a test. */
export function showText(v: number): string {
  const { digits, exponent } = show(v);
  return exponent === null ? digits : `${digits} × 10^${exponent}`;
}

/** Plain typing turned into the calculator's own symbols, one character for one. */
export function prettify(src: string): string {
  return src.replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−");
}

/** What the calculator shows, held by the panel so it survives closing it. */
export interface CalcState {
  expr: string;
  /** The last answer shown, or the error the last equals gave. */
  result: { value: number } | { error: string } | null;
  ans: number;
  mode: AngleMode;
  /** Equals was the last key: an operator carries on from Ans, anything else starts again. */
  fresh: boolean;
}

export const EMPTY_CALC: CalcState = { expr: "", result: null, ans: 0, mode: "deg", fresh: false };
