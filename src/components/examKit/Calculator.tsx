import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  CalcError,
  evaluate,
  prettify,
  show,
  showText,
  type CalcState,
} from "@/lib/examKit/calculator";
import { cn } from "@/lib/utils";

/**
 * A scientific calculator laid out like the one in the exam room: Shift for
 * the inverse functions, ×10ˣ for standard form, Ans for the last answer.
 * Keys or a keyboard both work; Enter is equals.
 *
 * What is keyed in stays put while the student goes back to the question, so
 * it is held by the panel and passed in, not kept here.
 */

interface Key {
  label: string;
  /** What it writes. */
  text: string;
  /** An operator carries on from Ans after equals; an operand starts afresh. */
  carries?: boolean;
  aria: string;
  /** With Shift held. */
  shift?: Omit<Key, "shift">;
  tone?: "digit" | "fn";
}

const k = (label: string, text: string, aria: string, extra: Partial<Key> = {}): Key => ({
  label,
  text,
  aria,
  tone: "fn",
  ...extra,
});
const digit = (d: string): Key => ({ label: d, text: d, aria: d, tone: "digit" });

const FUNCTION_ROWS: Key[][] = [
  [
    k("x²", "²", "squared", { carries: true, shift: k("x³", "³", "cubed", { carries: true }) }),
    k("√", "√(", "square root", { shift: k("∛", "∛(", "cube root") }),
    k("xʸ", "^(", "to the power", { carries: true }),
    k("x⁻¹", "⁻¹", "reciprocal", { carries: true }),
  ],
  [
    k("sin", "sin(", "sine", { shift: k("sin⁻¹", "sin⁻¹(", "inverse sine") }),
    k("cos", "cos(", "cosine", { shift: k("cos⁻¹", "cos⁻¹(", "inverse cosine") }),
    k("tan", "tan(", "tangent", { shift: k("tan⁻¹", "tan⁻¹(", "inverse tangent") }),
    k("log", "log(", "log", { shift: k("10ˣ", "10^(", "ten to the power") }),
    k("ln", "ln(", "natural log", { shift: k("eˣ", "e^(", "e to the power") }),
  ],
  [
    k("(", "(", "open bracket"),
    k(")", ")", "close bracket"),
    k("π", "π", "pi"),
    k("×10ˣ", "ᴇ", "times ten to the power"),
    k("Ans", "Ans", "last answer"),
  ],
];

const op = (label: string, aria: string): Key => k(label, label, aria, { carries: true });

const NUMBER_ROWS: (Key | "del" | "ac" | "eq")[][] = [
  [digit("7"), digit("8"), digit("9"), "del", "ac"],
  [digit("4"), digit("5"), digit("6"), op("×", "times"), op("÷", "divided by")],
  [digit("1"), digit("2"), digit("3"), op("+", "plus"), op("−", "minus")],
  [digit("0"), digit("."), "eq"],
];

/** Things DEL takes off in one press, as the calculator does, longest first. */
const WHOLE_TOKENS = [
  "sin⁻¹(",
  "cos⁻¹(",
  "tan⁻¹(",
  "sin(",
  "cos(",
  "tan(",
  "log(",
  "10^(",
  "ln(",
  "e^(",
  "√(",
  "∛(",
  "^(",
  "Ans",
  "⁻¹",
];

const KEY = "h-11 rounded-lg font-display text-sm font-bold sm:pointer-fine:h-9";

export function Calculator({
  state,
  onChange,
}: {
  state: CalcState;
  onChange: (next: CalcState) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Where the next key writes. Kept in a ref: it changes on every click into
  // the field and nothing needs to redraw for it.
  const caret = useRef<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [shift, setShift] = useState(false);

  useLayoutEffect(() => {
    const el = input.current;
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      caret.current = pendingCaret.current;
      pendingCaret.current = null;
    }
  });

  const at = () => {
    const c = caret.current;
    return c === null || c > state.expr.length ? state.expr.length : c;
  };

  const write = (key: Pick<Key, "text" | "carries">) => {
    let expr = state.expr;
    let pos = at();
    if (state.fresh) {
      expr = key.carries ? "Ans" : "";
      pos = expr.length;
    }
    const next = expr.slice(0, pos) + key.text + expr.slice(pos);
    pendingCaret.current = pos + key.text.length;
    onChange({ ...state, expr: next, result: null, fresh: false });
  };

  const press = (key: Key) => {
    write(shift && key.shift ? key.shift : key);
    setShift(false);
  };

  const del = () => {
    if (state.fresh) {
      pendingCaret.current = state.expr.length;
      onChange({ ...state, fresh: false, result: null });
      return;
    }
    const pos = at();
    if (pos === 0) return;
    const before = state.expr.slice(0, pos);
    const whole = WHOLE_TOKENS.find((t) => before.endsWith(t));
    const cut = whole ? whole.length : 1;
    pendingCaret.current = pos - cut;
    onChange({
      ...state,
      expr: state.expr.slice(0, pos - cut) + state.expr.slice(pos),
      result: null,
    });
  };

  const clear = () => {
    pendingCaret.current = 0;
    setShift(false);
    onChange({ ...state, expr: "", result: null, fresh: false });
  };

  const equals = () => {
    if (!state.expr.trim()) return;
    try {
      const value = evaluate(state.expr, state.mode, state.ans);
      onChange({ ...state, result: { value }, ans: value, fresh: true });
    } catch (e) {
      const error = e instanceof CalcError ? e.message : "Syntax error";
      onChange({ ...state, result: { error }, fresh: false });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "=") {
      e.preventDefault();
      equals();
      return;
    }
    if (e.key === "Escape" && state.expr) {
      // Only swallowed when there is something to clear, so Escape still
      // closes the drawer from an empty calculator.
      e.stopPropagation();
      clear();
      return;
    }
    // Straight after equals, typing works as the keys do: an operator carries
    // on from Ans, anything else starts a new sum.
    if (state.fresh && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      write({ text: prettify(e.key), carries: /[+\-*/^xX]/.test(e.key) });
    }
  };

  const shown = state.result && "value" in state.result ? show(state.result.value) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border-[1.5px] border-[color:color-mix(in_oklab,var(--tint)_24%,var(--edge))] bg-[color:color-mix(in_oklab,var(--tint)_5%,var(--card))] p-3">
        <input
          ref={input}
          value={state.expr}
          // The keys are the keyboard on a phone; a physical keyboard still types.
          inputMode="none"
          autoComplete="off"
          spellCheck={false}
          aria-label="Calculation"
          onChange={(e) => {
            const el = e.target;
            caret.current = el.selectionStart;
            onChange({ ...state, expr: prettify(el.value), result: null, fresh: false });
            pendingCaret.current = el.selectionStart;
          }}
          onSelect={(e) => (caret.current = e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent font-sans text-base font-semibold outline-none"
        />
        {/* The mode and Shift beside the answer, so the display stays two lines
            tall: on a phone every line of it covers the question. */}
        <div className="mt-1 flex min-h-9 items-end justify-between gap-2">
          <div className="flex shrink-0 items-center gap-1.5 pb-1">
            <button
              type="button"
              onClick={() => onChange({ ...state, mode: state.mode === "deg" ? "rad" : "deg" })}
              className="chip cursor-pointer"
              aria-label={`Angles in ${state.mode === "deg" ? "degrees" : "radians"}. Switch`}
            >
              {state.mode === "deg" ? "DEG" : "RAD"}
            </button>
            {shift && <span className="chip chip-solid tint-amber">SHIFT</span>}
          </div>
          <output
            aria-live="polite"
            className="min-w-0 text-right"
            aria-label={
              state.result
                ? "value" in state.result
                  ? showText(state.result.value)
                  : state.result.error
                : undefined
            }
          >
            {state.result && "error" in state.result ? (
              <span className="font-display text-lg font-extrabold text-destructive">
                {state.result.error}
              </span>
            ) : shown ? (
              <span
                className={cn(
                  "numeral",
                  // A long answer drops a size rather than wrapping its power of ten.
                  shown.digits.length + (shown.exponent === null ? 0 : 5) > 10
                    ? "text-2xl"
                    : "text-3xl",
                )}
              >
                {shown.digits.replace("-", "−")}
                {shown.exponent !== null && (
                  <>
                    {" "}
                    × 10<sup className="text-lg">{String(shown.exponent).replace("-", "−")}</sup>
                  </>
                )}
              </span>
            ) : null}
          </output>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-5 gap-1.5">
          <button
            type="button"
            onClick={() => setShift((s) => !s)}
            aria-pressed={shift}
            className={cn(KEY, "tint-amber", shift ? "btn-solid" : "btn-soft")}
          >
            Shift
          </button>
          {FUNCTION_ROWS[0].map((key) => (
            <KeyButton key={key.label} k={key} shift={shift} onPress={press} />
          ))}
        </div>
        {FUNCTION_ROWS.slice(1).map((row, i) => (
          <div key={i} className="grid grid-cols-5 gap-1.5">
            {row.map((key) => (
              <KeyButton key={key.label} k={key} shift={shift} onPress={press} />
            ))}
          </div>
        ))}
        {NUMBER_ROWS.map((row, i) => (
          <div key={i} className="grid grid-cols-5 gap-1.5">
            {row.map((key) =>
              key === "del" ? (
                <button
                  key="del"
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={del}
                  aria-label="Delete"
                  className={cn(KEY, "btn-soft tint-rose")}
                >
                  DEL
                </button>
              ) : key === "ac" ? (
                <button
                  key="ac"
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={clear}
                  aria-label="All clear"
                  className={cn(KEY, "btn-soft tint-rose")}
                >
                  AC
                </button>
              ) : key === "eq" ? (
                <button
                  key="eq"
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={equals}
                  aria-label="Equals"
                  className={cn(KEY, "btn-solid col-span-3 text-base")}
                >
                  =
                </button>
              ) : (
                <KeyButton key={key.label} k={key} shift={shift} onPress={press} />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyButton({ k, shift, onPress }: { k: Key; shift: boolean; onPress: (k: Key) => void }) {
  const face = shift && k.shift ? k.shift : k;
  return (
    <button
      type="button"
      // Keep the caret in the field on a computer, so a click on a key writes
      // where the student was typing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPress(k)}
      aria-label={face.aria}
      className={cn(KEY, "btn-soft", k.tone === "digit" && "tint-slate text-base")}
    >
      {face.label}
    </button>
  );
}
