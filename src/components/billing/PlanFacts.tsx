import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CreditCard,
  GraduationCap,
  Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CourseSummary } from "@/lib/courseSummary";

interface FactTileProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  /** One line of context under the value — why it matters, or what it implies. */
  hint?: React.ReactNode;
  /** The tile's own control, e.g. "Change" next to the exam board. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * One fact about the plan, in its own box: label, value, and — where the fact is
 * something the family can change — the control that changes it.
 */
function FactTile({ icon: Icon, label, value, hint, action, className = "" }: FactTileProps) {
  return (
    <div className={`rounded-xl surface-soft p-3.5 flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        {label}
      </div>
      <div className="text-sm font-semibold text-foreground leading-snug">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground leading-snug">{hint}</div>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-auto pt-1.5 self-start inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
        >
          {action.label}
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

interface PlanFactsProps {
  /** Level + per-subject boards. Omitted while the enrolment is still loading. */
  course?: CourseSummary;
  /** Who the card belongs to — "you", "Mum". Rendered capitalised. */
  payerLabel?: string;
  /** The reassurance under the payer, e.g. that they can stop it any time. */
  payerHint?: string;
  /** "Next bill" / "Access ends" / "Paused" — the shape of the date below. */
  billingLabel?: string;
  billingValue?: string;
  billingHint?: string;
  /** Jump to the board controls. Omitted when the viewer can't change boards. */
  onChangeBoard?: () => void;
  /** Jump to the subjects card, where subjects are added and dropped. */
  onManageSubjects?: () => void;
}

/**
 * The plan as a set of separate, individually-actionable facts rather than two
 * sentences of prose.
 *
 * "Studying GCSE · Edexcel — Biology, Chemistry" packed four different facts
 * into one line, and read as fixed: nothing about it suggested that three of the
 * four are things a family can change, or where. Splitting them into tiles makes
 * each one addressable — the board tile carries the control that changes the
 * board, the subjects tile the one that adds and drops subjects — and lets a
 * mixed-board student see which board goes with which subject, which the
 * sentence could never show.
 *
 * Every tile is optional: a fact we don't know is simply absent, never a
 * half-written sentence.
 */
export function PlanFacts({
  course,
  payerLabel,
  payerHint,
  billingLabel,
  billingValue,
  billingHint,
  onChangeBoard,
  onManageSubjects,
}: PlanFactsProps) {
  const perSubject = course?.perSubject ?? [];
  const tiles = [
    course?.levelLabel && (
      <FactTile
        key="level"
        icon={GraduationCap}
        label="Level"
        value={course.levelLabel}
        hint="Everything you're taught is scoped to this"
      />
    ),
    course?.boardSummary && (
      <FactTile
        key="board"
        icon={Layers}
        label="Exam board"
        value={course.mixedBoards ? "Mixed" : course.boardSummary}
        hint={course.mixedBoards ? course.boardSummary : "Never affects what you pay"}
        action={onChangeBoard ? { label: "Change board", onClick: onChangeBoard } : undefined}
      />
    ),
    billingValue && (
      <FactTile
        key="billing"
        icon={CalendarClock}
        label={billingLabel ?? "Next bill"}
        value={billingValue}
        hint={billingHint}
      />
    ),
    payerLabel && (
      <FactTile
        key="payer"
        icon={CreditCard}
        label="Paid by"
        value={payerLabel.charAt(0).toUpperCase() + payerLabel.slice(1)}
        hint={payerHint}
      />
    ),
  ].filter(Boolean);

  if (tiles.length === 0 && perSubject.length === 0) return null;

  return (
    <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {tiles}

      {perSubject.length > 0 && (
        <FactTile
          className="sm:col-span-2 lg:col-span-4"
          icon={BookOpen}
          label={perSubject.length === 1 ? "Subject" : `Subjects (${perSubject.length})`}
          value={
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {perSubject.map((s) => (
                <span
                  key={s.subject}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold"
                >
                  {s.subjectLabel}
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {s.boardLabel}
                  </span>
                </span>
              ))}
            </div>
          }
          action={
            onManageSubjects ? { label: "Add or remove", onClick: onManageSubjects } : undefined
          }
        />
      )}
    </div>
  );
}
