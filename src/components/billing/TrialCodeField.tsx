import { useState } from "react";
import { Gift } from "lucide-react";

/** Days a trial code gives. Mirrors TRIAL_DAYS in supabase/functions/_shared/trialCode.ts. */
export const TRIAL_DAYS = 14;

/** "11 October": the day a trial started today first charges. */
function firstChargeDay(): string {
  const d = new Date();
  d.setDate(d.getDate() + TRIAL_DAYS);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(d);
}

/**
 * Where a free-trial code goes before Checkout. Folded away behind a link for
 * everyone who hasn't got one; open and filled for someone who arrived from
 * the emailed link. With a code in, it states the terms: free until a date,
 * then the plan's price.
 */
export function TrialCodeField({
  value,
  onChange,
  thenPrice,
}: {
  value: string;
  onChange: (code: string) => void;
  /** What the plan costs after the trial, e.g. "£49.99 per month". */
  thenPrice?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open && !value) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
      >
        <Gift className="w-4 h-4" /> Have a free-trial code?
      </button>
    );
  }

  return (
    <div className="mt-4">
      <label htmlFor="trial-code" className="eyebrow text-[10px]">
        Free-trial code
      </label>
      <input
        id="trial-code"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="AE-XXXX-XXXX"
        autoComplete="off"
        spellCheck={false}
        autoFocus={!value}
        className="premium-input w-full h-11 rounded-xl px-4 text-sm mt-1 font-mono tracking-wider"
      />
      {value.trim() && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">{TRIAL_DAYS} days free</span>, then{" "}
          {thenPrice ?? "your plan"} from {firstChargeDay()}. Cancel before then and you pay
          nothing.
        </p>
      )}
    </div>
  );
}
