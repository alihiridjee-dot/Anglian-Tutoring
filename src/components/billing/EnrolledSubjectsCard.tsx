import { useState } from "react";
import { Loader2, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import {
  SUBJECTS,
  BOARDS,
  isLevel,
  isSubject,
  type BoardV,
  type SubjectV,
} from "@/lib/curriculum/taxonomy";
import { usePackages, useRemoveSubjects } from "@/hooks/data/useBilling";
import { useUpdateEnrolmentBoard } from "@/hooks/data/useEnrolments";
import { useCurriculumCoverage } from "@/hooks/data/useCurriculumCoverage";
import { formatPence } from "@/lib/billing/billing";
import { levelLabel } from "@/lib/curriculum/courseSummary";
import { planCadence, tierFor, CADENCES } from "@/lib/billing/entitlements";
import { RemoveSubjectDialog } from "@/components/billing/RemoveSubjectDialog";
import { SwitchBoardDialog } from "@/components/billing/SwitchBoardDialog";
import { recordBillingFeedback } from "@/lib/billing/billingFeedback";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { SectionHeading } from "@/components/Shared";

interface EnrolledSubjectsCardProps {
  /** subscriptions.student_id whose plan these subjects sit on. */
  studentId: string;
  /** The plan's current tier, e.g. "monthly_2" — sets the price ladder. */
  currentTier: string;
  /** What the plan covers today, with the board each is sat with. */
  enrolments: { subject: string; board: string }[];
  /** Exam level, so the price shown is off the right ladder. */
  level?: string | null;
  /** Whether the viewer may shrink the plan (payer or linked parent). */
  canManage: boolean;
  /**
   * Whether the viewer may move a subject onto a different exam board.
   *
   * Separate from `canManage` because it is a different authority entirely: the
   * board is an academic fact about the student, costs nothing to change, and
   * RLS lets only the student write their own enrolment rows — so a student on a
   * parent-paid plan has this while lacking every billing control, and a linked
   * parent has every billing control while lacking this.
   */
  canChangeBoard?: boolean;
  /** Whose plan it is ("Alex"), for the parent view. Omit for own plan. */
  ownerLabel?: string;
  /**
   * DOM id the cancel dialog's "drop a subject instead" scrolls to. Defaults to
   * "subjects"; the parent tab renders one card per child, so it passes a
   * per-child id to keep them unique.
   */
  anchorId?: string;
  /** More tiles at the end of the grid — the subjects that can be added. */
  extraTiles?: React.ReactNode;
}

const subjectLabel = (value: string) =>
  SUBJECTS.find((s) => s.value === value)?.label ?? value.charAt(0).toUpperCase() + value.slice(1);

const boardLabel = (value: string) => BOARDS.find((b) => b.value === value)?.label ?? value;

/**
 * What the plan actually covers, and the only place a single subject can be
 * dropped without ending the whole plan.
 *
 * This is the missing half of AddSubjectTiles: the page could grow a plan but
 * never shrink one, so "I want to stop Chemistry" had no answer short of
 * cancelling everything. Removal is gated by RemoveSubjectDialog and refused
 * outright on the last subject — a plan covering nothing is a cancellation, and
 * that has its own flow.
 *
 * Read-only (no Remove buttons) for a student on a plan someone else pays for;
 * they still see exactly what they're enrolled in and who to ask.
 */
export function EnrolledSubjectsCard({
  studentId,
  currentTier,
  enrolments,
  level,
  canManage,
  canChangeBoard = false,
  ownerLabel,
  anchorId = "subjects",
  extraTiles,
}: EnrolledSubjectsCardProps) {
  const { data: packages = [] } = usePackages(level);
  const remove = useRemoveSubjects();
  const switchBoard = useUpdateEnrolmentBoard();
  const { coverage } = useCurriculumCoverage();
  const [removing, setRemoving] = useState<string | null>(null);
  /** The pending board switch, held until the dialog confirms it. */
  const [switching, setSwitching] = useState<{ subject: string; board: BoardV } | null>(null);

  const cadence = planCadence(currentTier);
  const isLast = enrolments.length <= 1;

  // What the plan costs once this subject comes off — the ladder one step down.
  const nextPkg =
    cadence && !isLast
      ? packages.find((p) => p.tier === tierFor(cadence, enrolments.length - 1))
      : undefined;
  const unit = CADENCES.find((c) => c.key === cadence)?.unit;

  const confirmRemove = (category: string, comment: string) => {
    if (!removing) return;
    remove.mutate(
      { studentId, subjects: [removing] },
      {
        onSuccess: (res) => {
          // Only once the removal has worked: a refused one must not leave an
          // entry in the tutor's plan history.
          void recordBillingFeedback({
            studentId,
            action: "remove_subject",
            category,
            comment,
          });
          const label = subjectLabel(removing);
          setRemoving(null);
          toast.success(`${label} removed. Your next bill drops to the smaller plan.`, {
            description: `Still covered: ${res.remaining.map(subjectLabel).join(", ")}.`,
          });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  /** Boards that actually teach this subject at the student's level. */
  const boardsFor = (subject: string): BoardV[] =>
    isLevel(level) && isSubject(subject) ? coverage.boardsForSubject(level, subject) : [];

  const confirmSwitch = () => {
    if (!switching) return;
    switchBoard.mutate(
      { studentId, subject: switching.subject as SubjectV, board: switching.board },
      {
        onSuccess: ({ subject, board }) => {
          setSwitching(null);
          toast.success(`${subjectLabel(subject)} moved to ${boardLabel(board)}.`, {
            description:
              "Your lessons, quizzes and plan now follow that spec. Your price is unchanged.",
          });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <section id={anchorId} className="scroll-mt-24">
      <SectionHeading title="Subjects" />

      {/* One square tile per subject, then one per subject that can be added
          (from AddSubjectTiles), so the plan's coverage and its growth read as
          one grid. */}
      <div className="mt-3 grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 sm:grid-cols-3">
        {enrolments.map((e) => {
          const options = boardsFor(e.subject);
          const busy = switchBoard.isPending && switching?.subject === e.subject;
          return (
            <div
              key={e.subject}
              className={`pop-card pop-card-banded relative flex flex-col gap-3 p-4 sm:aspect-square sm:p-5 ${
                SUBJECT_TINT[e.subject] ?? "tint-primary"
              }`}
            >
              <h3 className="text-xl font-bold text-[color:var(--tint)]">
                {subjectLabel(e.subject)}
              </h3>

              {/* The board, as a control rather than a caption. Per subject
                  because that is how it is stored — a student may sit Biology
                  with AQA and Physics with OCR. */}
              {canChangeBoard ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label={`Exam board for ${subjectLabel(e.subject)}`}
                    className="inline-flex flex-wrap rounded-lg border border-border bg-muted/40 p-0.5"
                  >
                    {/* The current board, plus only those that teach this
                        subject at the student's level. Until coverage is known
                        that is just the current one: a switch to a board with
                        no spec would leave the subject empty. */}
                    {BOARDS.filter((b) => b.value === e.board || options.includes(b.value)).map(
                      (b) => {
                        const on = b.value === e.board;
                        return (
                          <button
                            key={b.value}
                            onClick={() => setSwitching({ subject: e.subject, board: b.value })}
                            disabled={on || switchBoard.isPending}
                            aria-pressed={on}
                            className={`tap-target h-8 rounded-md px-2.5 text-xs font-semibold transition disabled:cursor-default ${
                              on ? "btn-solid shadow-sm" : "hover:bg-card"
                            }`}
                          >
                            {b.label}
                          </button>
                        );
                      },
                    )}
                  </div>
                  {busy && <Loader2 className="size-4 animate-spin" aria-label="Switching" />}
                </div>
              ) : (
                <span className="chip self-start">{boardLabel(e.board)}</span>
              )}

              {canManage && !isLast && (
                <button
                  onClick={() => setRemoving(e.subject)}
                  disabled={remove.isPending}
                  className="btn-soft tint-rose mt-auto inline-flex h-11 items-center gap-1.5 self-start rounded-lg px-3 text-sm sm:pointer-fine:h-9"
                >
                  {remove.isPending && removing === e.subject ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <MinusCircle className="size-4" aria-hidden />
                  )}
                  Remove
                </button>
              )}
            </div>
          );
        })}
        {extraTiles}
      </div>

      {removing && (
        <RemoveSubjectDialog
          subjectLabel={subjectLabel(removing)}
          remainingLabels={enrolments
            .filter((e) => e.subject !== removing)
            .map((e) => subjectLabel(e.subject))}
          newPlanName={nextPkg?.name}
          newPriceLabel={nextPkg ? formatPence(nextPkg.price_pence) : undefined}
          unitLabel={unit}
          ownerLabel={ownerLabel}
          pending={remove.isPending}
          onConfirm={confirmRemove}
          onClose={() => setRemoving(null)}
        />
      )}

      {switching && (
        <SwitchBoardDialog
          subjectLabel={subjectLabel(switching.subject)}
          fromLabel={boardLabel(
            enrolments.find((e) => e.subject === switching.subject)?.board ?? "",
          )}
          toLabel={boardLabel(switching.board)}
          levelLabel={levelLabel(level)}
          pending={switchBoard.isPending}
          onConfirm={confirmSwitch}
          onClose={() => setSwitching(null)}
        />
      )}
    </section>
  );
}
