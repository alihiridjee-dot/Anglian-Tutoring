import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  SUBJECTS,
  BOARDS,
  isLevel,
  isSubject,
  type BoardV,
  type SubjectV,
} from "@/lib/curriculum/taxonomy";
import { useUpdateEnrolmentBoard } from "@/hooks/data/useEnrolments";
import { useCurriculumCoverage } from "@/hooks/data/useCurriculumCoverage";
import { levelLabel } from "@/lib/curriculum/courseSummary";
import { SwitchBoardDialog } from "@/components/billing/SwitchBoardDialog";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { SectionHeading } from "@/components/Shared";

interface EnrolledSubjectsCardProps {
  /** subscriptions.student_id whose plan these subjects sit on. */
  studentId: string;
  /** What the plan covers today, with the board each is sat with. */
  enrolments: { subject: string; board: string }[];
  /** Exam level, so only boards that teach the subject at it are offered. */
  level?: string | null;
  /**
   * Whether the viewer may move a subject onto a different exam board.
   *
   * A different authority from the billing controls: the board is an academic
   * fact about the student, costs nothing to change, and RLS lets only the
   * student write their own enrolment rows — so a student on a parent-paid plan
   * has this while lacking every billing control, and a linked parent has every
   * billing control while lacking this.
   */
  canChangeBoard?: boolean;
  /**
   * DOM id for this block. Defaults to "subjects"; the parent tab renders one
   * per child, so it passes a per-child id to keep them unique.
   */
  anchorId?: string;
  /** More tiles at the end of the grid — the subjects that can be added. */
  extraTiles?: React.ReactNode;
}

const subjectLabel = (value: string) =>
  SUBJECTS.find((s) => s.value === value)?.label ?? value.charAt(0).toUpperCase() + value.slice(1);

const boardLabel = (value: string) => BOARDS.find((b) => b.value === value)?.label ?? value;

/**
 * What the plan covers: one tile per subject, with its exam board, then the
 * subjects that can be added (AddSubjectTiles) in the same grid.
 *
 * Deliberately no Remove here — this block sells, it doesn't shrink. Dropping
 * one subject lives with pause and cancel in PlanLifecycleActions, at the very
 * bottom of the page.
 */
export function EnrolledSubjectsCard({
  studentId,
  enrolments,
  level,
  canChangeBoard = false,
  anchorId = "subjects",
  extraTiles,
}: EnrolledSubjectsCardProps) {
  const switchBoard = useUpdateEnrolmentBoard();
  const { coverage } = useCurriculumCoverage();
  /** The pending board switch, held until the dialog confirms it. */
  const [switching, setSwitching] = useState<{ subject: string; board: BoardV } | null>(null);

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
      <SectionHeading title="Your subjects" />

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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xl font-bold text-[color:var(--tint)]">
                  {subjectLabel(e.subject)}
                </h3>
                <span className="chip">
                  <Check className="size-3.5" aria-hidden /> Included
                </span>
              </div>
              {/* What the subject buys — every subject on a plan is one live
                  lesson a week, whatever the cadence. */}
              <p className="font-display text-lg font-bold">1 live lesson a week</p>

              {/* The board, as a control rather than a caption. Per subject
                  because that is how it is stored — a student may sit Biology
                  with AQA and Physics with OCR. */}
              <p className="eyebrow eyebrow-bare mt-auto">Exam board</p>
              {canChangeBoard ? (
                <div className="-mt-1 flex flex-wrap items-center gap-2">
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
                            // The current board is pressed, not disabled: the
                            // kit greys out a disabled button, which made the
                            // one board that's in use look switched off.
                            onClick={() =>
                              !on && setSwitching({ subject: e.subject, board: b.value })
                            }
                            disabled={!on && switchBoard.isPending}
                            aria-pressed={on}
                            className={`tap-target h-8 rounded-md px-2.5 text-xs font-semibold transition disabled:cursor-default ${
                              on ? "btn-solid cursor-default shadow-sm" : "hover:bg-card"
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
                <span className="chip -mt-1 self-start">{boardLabel(e.board)}</span>
              )}
            </div>
          );
        })}
        {extraTiles}
      </div>

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
