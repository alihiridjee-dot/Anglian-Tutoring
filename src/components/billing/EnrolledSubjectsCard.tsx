import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { SUBJECT_EMOJI, SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
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
  /** More rows at the end — the subjects that can be added (AddSubjectRows). */
  extraRows?: React.ReactNode;
  /**
   * Just the rows, with no heading or card of their own: Billing's trail
   * already draws the card they sit in.
   */
  bare?: boolean;
}

const subjectLabel = (value: string) =>
  SUBJECTS.find((s) => s.value === value)?.label ?? value.charAt(0).toUpperCase() + value.slice(1);

const boardLabel = (value: string) => BOARDS.find((b) => b.value === value)?.label ?? value;

/**
 * What the plan covers: one bare row per subject — its emoji in a round dot in
 * its colour, its name, and its exam board — then the subjects that can be
 * added (AddSubjectRows) as rows of the same kind.
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
  extraRows,
  bare = false,
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

  const rows = (
    <div>
      {enrolments.map((e) => {
        const options = boardsFor(e.subject);
        const busy = switchBoard.isPending && switching?.subject === e.subject;
        return (
          <div key={e.subject} className={`bill-row ${SUBJECT_TINT[e.subject] ?? "tint-primary"}`}>
            <span className="bill-dot" aria-hidden>
              {SUBJECT_EMOJI[e.subject] ?? "📘"}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-bold text-[color:var(--tint)]">
                {subjectLabel(e.subject)}
              </h3>
              {/* What the subject buys — every subject on a plan is one live
                  lesson a week, whatever the cadence. */}
              <p className="font-semibold">One live lesson a week</p>
            </div>

            {/* The board, as a control rather than a caption. Per subject
                because that is how it is stored — a student may sit Biology
                with AQA and Physics with OCR. */}
            {canChangeBoard ? (
              <div className="flex items-center gap-2">
                {busy && <Loader2 className="size-4 animate-spin" aria-label="Switching" />}
                <div
                  role="group"
                  aria-label={`Exam board for ${subjectLabel(e.subject)}`}
                  className="bill-boards"
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
                          type="button"
                          // The current board is pressed, not disabled: the
                          // kit greys out a disabled button, which made the
                          // one board that's in use look switched off.
                          onClick={() =>
                            !on && setSwitching({ subject: e.subject, board: b.value })
                          }
                          disabled={!on && switchBoard.isPending}
                          aria-pressed={on}
                        >
                          {b.label}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
            ) : (
              <p className="font-display text-lg font-bold">{boardLabel(e.board)}</p>
            )}
          </div>
        );
      })}
      {extraRows}
    </div>
  );

  const dialog = switching && (
    <SwitchBoardDialog
      subjectLabel={subjectLabel(switching.subject)}
      fromLabel={boardLabel(enrolments.find((e) => e.subject === switching.subject)?.board ?? "")}
      toLabel={boardLabel(switching.board)}
      levelLabel={levelLabel(level)}
      pending={switchBoard.isPending}
      onConfirm={confirmSwitch}
      onClose={() => setSwitching(null)}
    />
  );

  if (bare)
    return (
      <div id={anchorId} className="scroll-mt-24">
        {rows}
        {dialog}
      </div>
    );

  return (
    <section id={anchorId} className="scroll-mt-24">
      <SectionHeading title="Your subjects" />
      <div className="premium-card mt-3 rounded-2xl p-2 sm:p-3">{rows}</div>
      {dialog}
    </section>
  );
}
