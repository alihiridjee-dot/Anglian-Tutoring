import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Number of digit boxes. Must match the project's Email OTP Length setting. */
  length?: number;
  onComplete?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

/**
 * One box per digit. Backed by real inputs rather than a single field with
 * letter-spacing so mobile keyboards, one-time-code autofill and paste all
 * behave; only the first box carries autoComplete="one-time-code", which is
 * what iOS/Android look for before filling the whole code.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  onComplete,
  disabled,
  autoFocus,
}: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const hadValue = useRef(false);
  const digits = value.split("");

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // A rejected code is cleared by the parent; put the caret back at the start so
  // the retry is just typing, not hunting for the first box.
  useEffect(() => {
    if (value === "" && !disabled && hadValue.current) {
      refs.current[0]?.focus();
    }
    hadValue.current = value.length > 0;
  }, [value, disabled]);

  const focusAt = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  };

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.();
    return clean;
  };

  const handleChange = (i: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;
    // Autofill and paste land here as a multi-digit string: spread it forward
    // from the box that received it rather than keeping only the first digit.
    const chars = value.split("");
    for (let k = 0; k < typed.length && i + k < length; k++) chars[i + k] = typed[k];
    const next = commit(chars.join("").slice(0, length));
    focusAt(Math.min(i + typed.length, length - 1));
    if (next.length === length) refs.current[length - 1]?.blur();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const chars = value.split("");
      if (chars[i]) {
        chars[i] = "";
        commit(chars.join(""));
      } else if (i > 0) {
        chars[i - 1] = "";
        commit(chars.join(""));
        focusAt(i - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(i + 1);
    }
  };

  const handlePaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    handleChange(i, e.clipboardData.getData("text"));
  };

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-2.5" role="group" aria-label="Verification code">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          disabled={disabled}
          value={digits[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          className={`h-14 w-full min-w-0 max-w-[3.25rem] rounded-xl border bg-background text-center text-xl font-semibold tabular-nums caret-primary
            transition-[border-color,box-shadow,background-color] duration-150
            focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15
            disabled:opacity-60 ${digits[i] ? "border-primary/50 bg-primary/[0.04]" : "border-border"}`}
        />
      ))}
    </div>
  );
}
