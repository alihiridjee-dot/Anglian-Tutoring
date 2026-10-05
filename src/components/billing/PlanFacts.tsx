import { CalendarClock, CreditCard } from "lucide-react";
import type { CourseSummary } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { CourseChip } from "@/components/CourseBadge";
import { StatTile } from "@/components/Shared";

interface PlanFactsProps {
  /** Who the card belongs to — "you", "Mum". Rendered capitalised. */
  payerLabel?: string;
  /** "Next bill" / "Access ends" / "Was due" — the shape of the date. */
  billingLabel?: string;
  /** Short date, e.g. "22 Oct". */
  billingValue?: string;
  /** One more tile at the end of the row, e.g. the Card & invoices button. */
  extraTile?: React.ReactNode;
  /**
   * Subject chips under the tiles. Only for views with no Subjects block of
   * their own (the tutor's record page, an overdue plan) — elsewhere the
   * Subjects block sits right below and says it better.
   */
  subjectsCourse?: CourseSummary;
}

/**
 * The plan's facts as a row of tiles: when it next bills, who pays, and
 * whatever control the panel adds at the end. Every tile is optional: a fact we
 * don't know is simply absent.
 */
export function PlanFacts({
  payerLabel,
  billingLabel = "Next bill",
  billingValue,
  extraTile,
  subjectsCourse,
}: PlanFactsProps) {
  const perSubject = subjectsCourse?.perSubject ?? [];
  const showTiles = !!(billingValue || payerLabel || extraTile);

  if (!showTiles && perSubject.length === 0) return null;

  return (
    <>
      {showTiles && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {billingValue && (
            <StatTile label={billingLabel} value={billingValue} icon={CalendarClock} />
          )}
          {payerLabel && (
            <StatTile
              label="Paid by"
              value={payerLabel.charAt(0).toUpperCase() + payerLabel.slice(1)}
              icon={CreditCard}
            />
          )}
          {extraTile}
        </div>
      )}

      {perSubject.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {perSubject.map((s) => (
            <CourseChip
              key={s.subject}
              tint={SUBJECT_TINT[s.subject] ?? "tint-primary"}
              parts={[s.subjectLabel, s.boardLabel]}
            />
          ))}
        </div>
      )}
    </>
  );
}
