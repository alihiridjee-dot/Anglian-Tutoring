import { useState } from "react";
import { Gift } from "lucide-react";
import { trialLength } from "@/lib/billing/trialCode";
import { useTrialTerms } from "@/hooks/data/useBilling";

/** "11 October" (or "9 August 2027" next year): the day a trial started today ends. */
function trialEndDay(days: number): string {
  const d = new Date();
  const thisYear = d.getFullYear();
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== thisYear ? { year: "numeric" as const } : {}),
  }).format(d);
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
  className = "mt-4",
}: {
  value: string;
  onChange: (code: string) => void;
  /** What the plan costs after the trial, e.g. "£49.99 per month". */
  thenPrice?: string;
  /** Spacing from the field above; the plan page sets its own. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const terms = useTrialTerms(value);

  if (!open && !value) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${className} inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline`}
      >
        <Gift className="w-4 h-4" /> Have a free-trial code?
      </button>
    );
  }

  return (
    <div className={className}>
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
      {terms.data &&
        (terms.data.needsCard ? (
          <p className="mt-2 text-sm">
            <span className="font-semibold">{trialLength(terms.data.days)} free</span>, then{" "}
            {thenPrice ?? "your plan"} from {trialEndDay(terms.data.days)}. Cancel before then and
            you pay nothing.
          </p>
        ) : (
          <p className="mt-2 text-sm">
            <span className="font-semibold">
              {trialLength(terms.data.days)} free, no card needed.
            </span>{" "}
            The trial ends on {trialEndDay(terms.data.days)}; pick a plan then to keep going.
          </p>
        ))}
      {terms.error && (
        <p role="alert" className="mt-2 tint-rose chip whitespace-normal">
          {terms.error.message}
        </p>
      )}
    </div>
  );
}
