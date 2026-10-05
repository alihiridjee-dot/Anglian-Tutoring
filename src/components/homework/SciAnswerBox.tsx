import { useMemo, useRef, type TextareaHTMLAttributes } from "react";
import { SciText } from "@/components/Shared";
import { toSciNotation, toggleScript } from "@/lib/platform/sciNotation";

/**
 * A text box for science answers.
 *
 * Students type on a keyboard, so "H2O" and "Mg2+" are what arrive. Two things
 * help:
 * - the chips under the box show how what they typed will read (H₂O, Mg²⁺),
 *   so they can see the site understood it;
 * - the x₂ and x² buttons make the figures just before the cursor (or a
 *   selection) small, for anything the automatic reading can't guess.
 *
 * The answer is saved exactly as typed; it is only ever shown formatted.
 */
export function SciAnswerBox({
  value,
  onValueChange,
  context = "",
  className,
  ...rest
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** The question being answered, read for clues: see `toSciNotation`. */
  context?: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const read = useMemo(() => recognised(value, context), [value, context]);

  const press = (kind: "sub" | "sup") => {
    const box = ref.current;
    if (!box) return;
    const next = toggleScript(value, box.selectionStart, box.selectionEnd, kind);
    if (next.value === value) return;
    onValueChange(next.value);
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(next.end, next.end);
    });
  };

  return (
    <div className="space-y-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={className}
        {...rest}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {read.map((t) => (
          <span key={t} className="chip">
            <SciText text={t} context={context} />
          </span>
        ))}
        <span className="ml-auto flex gap-1.5">
          {(["sub", "sup"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={rest.disabled}
              // Keep the box's cursor and selection where they are.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => press(kind)}
              aria-label={kind === "sub" ? "Subscript" : "Superscript"}
              title={kind === "sub" ? "Subscript: H2 → H₂" : "Superscript: Mg2+ → Mg²⁺"}
              className="btn-premium inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-semibold disabled:opacity-60 sm:pointer-fine:min-h-8 sm:pointer-fine:min-w-8"
            >
              x<SciText text={kind === "sub" ? "₂" : "²"} />
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}

/** The words the box will show differently (H2O -> H₂O), each once, at most six. */
function recognised(text: string, context: string): string[] {
  const out = new Set<string>();
  const trim = (w: string) => w.replace(/^[("'[]+|[)"'\],.;:!?]+$/g, "");
  const words = text.split(/\s+/);
  let formatted = toSciNotation(text, context).split(/\s+/);
  // An arrow typed as "->" gains spaces; read word by word instead.
  if (words.length !== formatted.length) formatted = words.map((w) => toSciNotation(w, context));
  words.forEach((w, i) => {
    const f = trim(formatted[i]);
    if (f && trim(w) !== f) out.add(f);
  });
  return [...out].slice(0, 6);
}
