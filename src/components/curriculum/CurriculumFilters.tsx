import { Link } from "@tanstack/react-router";
import { type Entitlements } from "@/hooks/data/useEntitlements";
import {
  SUBJECTS,
  BOARDS,
  LEVELS,
  type SubjectV,
  type BoardV,
  type LevelV,
} from "@/lib/curriculum/taxonomy";
import { Sparkles, GraduationCap, Lock } from "lucide-react";
import { inputCls, labelOf } from "@/components/curriculum/styles";

/**
 * The student's subject switcher: entitled subjects are selectable chips; the
 * rest are shown locked and greyed, so a student sees exactly what their plan
 * covers and a clear, low-pressure nudge to add the others. Board and level are
 * fixed to their enrolment (read-only labels) — they don't get to browse other
 * boards. Tutors use the free three-dropdown Filter row instead.
 */
export function StudentSubjectPicker({
  subject,
  onSelect,
  board,
  level,
  entitlements,
}: {
  subject: SubjectV;
  onSelect: (s: SubjectV) => void;
  board: BoardV;
  level: LevelV;
  entitlements: Entitlements;
}) {
  const { isEntitled, lockedSubjects } = entitlements;
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Your subjects
        </label>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <GraduationCap className="w-3.5 h-3.5" />
          {labelOf(LEVELS, level)} · {labelOf(BOARDS, board)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUBJECTS.map((s) => {
          const entitled = isEntitled(s.value);
          const active = s.value === subject;
          if (!entitled) {
            return (
              <span
                key={s.value}
                title="Not included in your plan — add it from Billing."
                className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3.5 rounded-lg border border-dashed border-border bg-muted/40 text-sm font-semibold text-muted-foreground/70 cursor-not-allowed select-none"
              >
                <Lock className="w-3.5 h-3.5" /> {s.label}
              </span>
            );
          }
          return (
            <button
              key={s.value}
              onClick={() => onSelect(s.value)}
              className={`inline-flex items-center gap-1.5 h-11 sm:h-9 px-3.5 rounded-lg border text-sm font-semibold transition ${
                active
                  ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/20"
                  : "border-border hover:bg-muted"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {lockedSubjects.length > 0 && (
        <Link
          to="/billing"
          className="mt-3 inline-flex items-center gap-1.5 min-h-11 sm:min-h-0 text-xs font-semibold text-primary hover:underline"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Add {lockedSubjects.map((s) => labelOf(SUBJECTS, s)).join(" & ")} to your plan
        </Link>
      )}
    </div>
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
        className={inputCls + " h-10 min-h-11 sm:min-h-0 mt-1"}
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
