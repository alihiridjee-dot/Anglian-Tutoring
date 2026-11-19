import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type FocusEvent,
  type MouseEvent,
  type TextareaHTMLAttributes,
} from "react";
import { SciText } from "@/components/Shared";
import { typedOnly } from "@/lib/homework/pasteGuard";
import { insertSymbol, scriptTyped, toSciNotation, toggleScript } from "@/lib/platform/sciNotation";

type Script = "sub" | "sup";

/** One button in the Units panel: what it puts in, and whether x² comes on after it. */
type Pick = { text: string; spaced: boolean; label?: string; then?: Script };

const unit = (text: string): Pick => ({ text, spaced: true });
const symbol = (text: string): Pick => ({ text, spaced: false });

/**
 * The Units panel, a row per kind: the units a GCSE or A-level science
 * answer is given in, and the symbols a keyboard has no key for (μ, Ω, °).
 */
const UNITS: Pick[][] = [
  ["nm", "μm", "mm", "cm", "m", "km"].map(unit),
  ["mm²", "cm²", "m²", "cm³", "dm³", "m³"].map(unit),
  ["s", "m/s", "m/s²", "kg", "N", "Pa", "kPa", "kg/m³"].map(unit),
  ["J", "kJ", "W", "kW", "kWh", "V", "A", "Ω", "C", "Hz"].map(unit),
  ["g", "mol", "g/mol", "mol/dm³", "g/dm³", "°C", "K"].map(unit),
  [
    { text: "× 10", spaced: true, label: "× 10ⁿ", then: "sup" },
    ...["μ", "°", "±", "Δ", "λ"].map(symbol),
    ...["→", "⇌"].map(unit),
  ],
];

const SMALL_BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-semibold disabled:opacity-60 sm:pointer-fine:min-h-8 sm:pointer-fine:min-w-8";

/**
 * A text box for science: answers, questions, mark schemes and feedback.
 *
 * People type on a keyboard, so "H2O" and "Mg2+" are what arrive. Two things
 * help:
 * - the chips under the box show how what they typed will read (H₂O, Mg²⁺),
 *   so they can see the site understood it;
 * - the x₂ and x² buttons work as in a word processor. Press one and what you
 *   type next comes out small; press it again, or type a space, to go back.
 *   With text selected, a press makes the selection small instead.
 *
 * What is typed is saved as typed; it is only ever shown formatted.
 */
export function SciAnswerBox({
  value,
  onValueChange,
  context = "",
  noPaste = false,
  className,
  onBlur,
  ...rest
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** The question being answered, read for clues: see `toSciNotation`. */
  context?: string;
  /** A student's task answer: typed, not pasted in (see pasteGuard). */
  noPaste?: boolean;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const read = useMemo(() => recognised(value, context), [value, context]);
  const [held, setHeld] = useState<Script | null>(null);
  const [unitsOpen, setUnitsOpen] = useState(false);
  // The box itself, kept from its own events: the dev server's component
  // tagger replaces a textarea's ref, which left the buttons dead in preview.
  const box = useRef<HTMLTextAreaElement | null>(null);
  // Where the cursor belongs after a re-render that rewrote the text. React
  // otherwise puts it at the end whenever the value it is given changes.
  const caret = useRef<{ start: number; end: number } | null>(null);
  // The text when a phone keyboard began composing a word, to compare with
  // once it finishes; the text can't be rewritten mid-composition.
  const composedFrom = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (caret.current && box.current) {
      box.current.setSelectionRange(caret.current.start, caret.current.end);
      caret.current = null;
    }
  });

  const typed = (el: HTMLTextAreaElement, before: string) => {
    if (!held) return onValueChange(el.value);
    const next = scriptTyped(before, el.value, el.selectionEnd, held);
    if (next.done) setHeld(null);
    if (next.value !== el.value) caret.current = { start: el.selectionEnd, end: el.selectionEnd };
    onValueChange(next.value);
  };

  const change = (e: ChangeEvent<HTMLTextAreaElement>) => {
    box.current = e.currentTarget;
    if ((e.nativeEvent as InputEvent).isComposing || composedFrom.current !== null)
      return onValueChange(e.currentTarget.value);
    typed(e.currentTarget, value);
  };

  const composed = (e: CompositionEvent<HTMLTextAreaElement>) => {
    const from = composedFrom.current;
    composedFrom.current = null;
    if (from !== null) typed(e.currentTarget, from);
  };

  const boxOf = (e: MouseEvent<HTMLButtonElement>) => {
    const el =
      box.current ?? e.currentTarget.closest("[data-sci-answer]")?.querySelector("textarea");
    if (el) box.current = el;
    return el;
  };

  const press = (kind: Script, e: MouseEvent<HTMLButtonElement>) => {
    const el = boxOf(e);
    if (!el) return;
    if (el.selectionStart !== el.selectionEnd) {
      const next = toggleScript(value, el.selectionStart, el.selectionEnd, kind);
      caret.current = { start: next.start, end: next.end };
      onValueChange(next.value);
      setHeld(null);
    } else {
      setHeld(held === kind ? null : kind);
    }
    el.focus();
  };

  // A unit from the panel goes in at the cursor; the panel stays open for the next.
  const pick = (p: Pick, e: MouseEvent<HTMLButtonElement>) => {
    const el = boxOf(e);
    if (!el) return;
    const next = insertSymbol(value, el.selectionStart, el.selectionEnd, p.text, p.spaced);
    caret.current = { start: next.caret, end: next.caret };
    onValueChange(next.value);
    setHeld(p.then ?? null);
    el.focus();
  };

  // Leaving the box lets go, unless it was for one of its own buttons.
  const left = (e: FocusEvent<HTMLTextAreaElement>) => {
    const to = e.relatedTarget as HTMLElement | null;
    if (!to?.closest("[data-sci-answer]")) setHeld(null);
    onBlur?.(e);
  };

  return (
    <div data-sci-answer className="space-y-2">
      <textarea
        value={value}
        onChange={change}
        onFocus={(e) => (box.current = e.currentTarget)}
        onBlur={left}
        onCompositionStart={() => (composedFrom.current = value)}
        onCompositionEnd={composed}
        {...(noPaste ? typedOnly : undefined)}
        className={className}
        {...rest}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {read.map((t) => (
          <span key={t} className="chip">
            {/* One child, so the chip's gap doesn't split Mg from ²⁺. */}
            <span>
              <SciText text={t} context={context} />
            </span>
          </span>
        ))}
        <span className="ml-auto flex gap-1.5">
          <button
            type="button"
            disabled={rest.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setUnitsOpen((o) => !o)}
            aria-expanded={unitsOpen}
            title="Units and symbols: μm, cm³, Ω, °C and more"
            className={`${unitsOpen ? "btn-solid" : "btn-soft"} ${SMALL_BUTTON}`}
          >
            Units
          </button>
          {(["sub", "sup"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={rest.disabled}
              // Keep the box's cursor and selection where they are.
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => press(kind, e)}
              aria-pressed={held === kind}
              aria-label={kind === "sub" ? "Subscript" : "Superscript"}
              title={
                kind === "sub"
                  ? "Subscript: press, type the small figures, press again (H₂O)"
                  : "Superscript: press, type the small figures, press again (Mg²⁺)"
              }
              className={`${held === kind ? "btn-solid" : "btn-soft"} ${SMALL_BUTTON}`}
            >
              x<SciText text={kind === "sub" ? "₂" : "²"} />
            </button>
          ))}
        </span>
      </div>
      {unitsOpen && !rest.disabled && (
        <div role="group" aria-label="Units and symbols" className="space-y-1.5">
          {UNITS.map((row, i) => (
            <div key={i} className="flex flex-wrap gap-1.5">
              {row.map((p) => (
                <button
                  key={p.text}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => pick(p, e)}
                  // Said in full: SciText's small figures aren't read out (cm³, not cm).
                  aria-label={p.label ?? p.text}
                  className={`btn-soft ${SMALL_BUTTON}`}
                >
                  <SciText text={p.label ?? p.text} />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small letters and punctuation only: no figure, capital, sign or arrow for toSciNotation to take. */
const PLAIN_WORD = /^[a-z'’"(),.;:!?]*$/;

/** The words the box will show with small figures (H2O -> H₂O), each once, at most six. */
function recognised(text: string, context: string): string[] {
  const out = new Set<string>();
  const trim = (w: string) => w.replace(/^[("'[]+|[)"'\],.;:!?]+$/g, "");
  const words = text.split(/\s+/);
  let formatted = toSciNotation(text, context).split(/\s+/);
  // An arrow typed as "->" gains spaces; read word by word instead. A word of
  // small letters alone has nothing to rewrite, so it is passed over: reading
  // every word with the whole question beside it lagged each keystroke of a
  // long answer.
  if (words.length !== formatted.length)
    formatted = words.map((w) => (PLAIN_WORD.test(w) ? w : toSciNotation(w, context)));
  words.forEach((w, i) => {
    const f = trim(formatted[i]);
    if (f && trim(w) !== f && /[₀-₉⁰¹²³⁴-⁹⁺⁻]/.test(f)) out.add(f);
  });
  return [...out].slice(0, 6);
}
