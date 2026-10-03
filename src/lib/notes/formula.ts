/**
 * A tiny arithmetic language for slider diagrams in revision notes.
 *
 * Notes are data written by a model, so a formula must never be run as code.
 * This parses numbers, the slider's own variable names, + - * / ^, brackets
 * and a few functions (sqrt, abs, min, max), and nothing else.
 */

type Node =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "neg"; a: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { t: "call"; fn: "sqrt" | "abs" | "min" | "max"; args: Node[] };

const FNS = ["sqrt", "abs", "min", "max"] as const;

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),])/y;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`unexpected "${src.slice(i, i + 8)}"`);
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const take = (s?: string) => {
    const t = toks[p++];
    if (s && t !== s) throw new Error(`expected "${s}" but found "${t ?? "end"}"`);
    return t;
  };
  // expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ;
  // unary := '-' unary | power ; power := atom ('^' unary)?   — so -2^2 is -4, as in maths.
  const expr = (): Node => {
    let a = term();
    while (peek() === "+" || peek() === "-") {
      const op = take() as "+" | "-";
      a = { t: "bin", op, a, b: term() };
    }
    return a;
  };
  const term = (): Node => {
    let a = unary();
    while (peek() === "*" || peek() === "/") {
      const op = take() as "*" | "/";
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => (peek() === "-" ? (take(), { t: "neg", a: unary() }) : power());
  const power = (): Node => {
    const a = atom();
    return peek() === "^" ? (take(), { t: "bin", op: "^", a, b: unary() }) : a;
  };
  const atom = (): Node => {
    const t = take();
    if (t === undefined) throw new Error("formula ends too early");
    if (t === "(") {
      const e = expr();
      take(")");
      return e;
    }
    if (/^\d/.test(t)) return { t: "num", v: Number(t) };
    if (/^[A-Za-z_]/.test(t)) {
      if ((FNS as readonly string[]).includes(t)) {
        take("(");
        const args = [expr()];
        while (peek() === ",") {
          take();
          args.push(expr());
        }
        take(")");
        return { t: "call", fn: t as (typeof FNS)[number], args };
      }
      return { t: "var", name: t };
    }
    throw new Error(`unexpected "${t}"`);
  };
  const tree = expr();
  if (p < toks.length) throw new Error(`unexpected "${toks[p]}"`);
  return tree;
}

export function variablesOf(n: Node, into = new Set<string>()): Set<string> {
  if (n.t === "var") into.add(n.name);
  else if (n.t === "neg") variablesOf(n.a, into);
  else if (n.t === "bin") {
    variablesOf(n.a, into);
    variablesOf(n.b, into);
  } else if (n.t === "call") n.args.forEach((a) => variablesOf(a, into));
  return into;
}

export function evaluate(n: Node, vars: Record<string, number>): number {
  switch (n.t) {
    case "num":
      return n.v;
    case "var": {
      if (!(n.name in vars)) throw new Error(`unknown name "${n.name}"`);
      return vars[n.name];
    }
    case "neg":
      return -evaluate(n.a, vars);
    case "bin": {
      const a = evaluate(n.a, vars),
        b = evaluate(n.b, vars);
      return n.op === "+"
        ? a + b
        : n.op === "-"
          ? a - b
          : n.op === "*"
            ? a * b
            : n.op === "/"
              ? a / b
              : a ** b;
    }
    case "call": {
      const xs = n.args.map((a) => evaluate(a, vars));
      return n.fn === "sqrt"
        ? Math.sqrt(xs[0])
        : n.fn === "abs"
          ? Math.abs(xs[0])
          : n.fn === "min"
            ? Math.min(...xs)
            : Math.max(...xs);
    }
  }
}
