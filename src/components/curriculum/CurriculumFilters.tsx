import { Link } from "@tanstack/react-router";
import { SUBJECTS, type SubjectV } from "@/lib/curriculum/taxonomy";
import { Sparkles } from "lucide-react";
import { inputCls, labelOf } from "@/components/curriculum/styles";

/**
 * The nudge to add the subjects a student's plan doesn't cover, linked to
 * Billing. It used to close a row of subject chips (the ones on the plan to
 * pick, the rest locked); picking moved to the header slider, and this is the
 * part of that row only the curriculum page had a reason to say.
 */
export function AddSubjectsLink({ lockedSubjects }: { lockedSubjects: readonly SubjectV[] }) {
  if (lockedSubjects.length === 0) return null;
  return (
    <Link
      to="/billing"
      className="mt-3 inline-flex items-center gap-1.5 min-h-11 sm:pointer-fine:min-h-0 text-xs font-semibold text-primary hover:underline"
    >
      <Sparkles className="w-3.5 h-3.5" />
      Add {lockedSubjects.map((s) => labelOf(SUBJECTS, s)).join(" & ")} to your plan
    </Link>
  );
}

export function Filter<T extends string>({
  label,
  value,
  onChange,
  opts,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  opts: readonly { value: T; label: string }[];
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </label>
      <select
        className={inputCls + " h-10 min-h-11 sm:pointer-fine:min-h-0 mt-1"}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
