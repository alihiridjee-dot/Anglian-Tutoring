import { ArrowRight, CalendarClock, CreditCard } from "lucide-react";
import type { CourseSummary } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { CourseChip } from "@/components/CourseBadge";

interface PlanFactsProps {
  /** Level + per-subject boards. Omitted while the enrolment is still loading. */
  course?: CourseSummary;
  /** Who the card belongs to — "you", "Mum". */
  payerLabel?: string;
  /** "Next bill" / "Access ends" / "Was due" — the shape of the date. */
  billingLabel?: string;
  billingValue?: string;
  /** Jump to the board controls. Omitted when the viewer can't change boards. */
  onChangeBoard?: () => void;
  /** Jump to the subjects card, where subjects are added and dropped. */
  onManageSubjects?: () => void;
}

/**
 * The plan's facts as chips: level and board, the billing date, who pays, then
 * one chip per subject, then the links that change the board and the subjects.
 *
 * Every chip is optional: a fact we don't know is simply absent. A student on
 * more than one board gets no board in the level chip — each subject chip names
 * its own board, which is the only honest way to show a mix.
 */
export function PlanFacts({
  course,
  payerLabel,
  billingLabel = "Next bill",
  billingValue,
  onChangeBoard,
  onManageSubjects,
}: PlanFactsProps) {
  const perSubject = course?.perSubject ?? [];
  const showFacts = !!(course?.levelLabel || billingValue || payerLabel);
  const showLinks = !!(onChangeBoard || onManageSubjects);

  if (!showFacts && perSubject.length === 0 && !showLinks) return null;

  return (
    <div className="mt-4 space-y-3">
      {showFacts && (
        <div className="flex flex-wrap gap-2">
          <CourseChip
            icon
            parts={[course?.levelLabel, course?.mixedBoards ? null : course?.boardSummary]}
          />
          {billingValue && (
            <span className="chip tint-slate whitespace-nowrap">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {billingLabel} {billingValue}
            </span>
          )}
          {payerLabel && (
            <span className="chip tint-slate whitespace-nowrap">
              <CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Paid by {payerLabel}
            </span>
          )}
        </div>
      )}

      {perSubject.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {perSubject.map((s) => (
            <CourseChip
              key={s.subject}
              tint={SUBJECT_TINT[s.subject] ?? "tint-primary"}
              parts={[s.subjectLabel, s.boardLabel]}
            />
          ))}
        </div>
      )}

      {showLinks && (
        <div className="flex flex-wrap gap-x-5">
          {onChangeBoard && <FactLink label="Change board" onClick={onChangeBoard} />}
          {onManageSubjects && (
            <FactLink label="Add or remove subjects" onClick={onManageSubjects} />
          )}
        </div>
      )}
    </div>
  );
}

function FactLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-primary hover:underline sm:pointer-fine:min-h-0"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
