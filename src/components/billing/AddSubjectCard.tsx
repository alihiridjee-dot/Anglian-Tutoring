import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { SUBJECTS, BOARDS, isLevel, isSubject, type BoardV } from "@/lib/curriculum/taxonomy";
import { usePackages, useAddSubjects } from "@/hooks/data/useBilling";
import { useCurriculumCoverage } from "@/hooks/data/useCurriculumCoverage";
import { formatPence } from "@/lib/billing/billing";
import { SUBJECT_EMOJI, SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import {
  planCadence,
  planSubjectCount,
  tierFor,
  pricePerWeek,
  CADENCES,
  PLAN_MAX_SUBJECTS,
  WEEKS_PER_CYCLE,
} from "@/lib/billing/entitlements";

interface AddSubjectRowsProps {
  /** subscriptions.student_id whose plan is being grown. */
  studentId: string;
  /** The student's current plan tier, e.g. "monthly_1". */
  currentTier: string;
  /** Subjects already on the plan (won't be offered again). */
  enrolledSubjects: string[];
  /** Board to pre-fill new subjects with (their existing board). */
  defaultBoard?: BoardV;
  /** Whose plan it is ("Alex"), for the parent view. Omit for own plan. */
  ownerLabel?: string;
  /** Exam level of the student being upgraded, so the price delta shown
   *  matches the ladder they will actually be charged on. */
  level?: string | null;
}

/** Whole pounds drop the pence: "£1", not "£1.00". */
const friendlyPence = (pence: number) =>
  pence % 100 === 0 ? `£${pence / 100}` : formatPence(pence);

/** Counts in a sentence are words: "Four more live lessons a month". */
const NUMBER_WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
];

/**
 * The frictionless upgrade, as rows under the subjects already on the plan:
 * one per subject that can still be added, its emoji in a dashed dot in that
 * subject's colour, leading with the lessons it buys and the smallest true
 * figure — what it adds per week ("for just £1 a week"). Same cadence, one step
 * up the subject-count ladder, prorated and charged now.
 *
 * Two taps, never one: the first opens the row (board choice and the charge
 * spelled out), the second adds it. Renders nothing when there's nothing to
 * sell (plan already covers every subject, or the tier isn't one we can
 * upgrade automatically).
 */
export function AddSubjectRows({
  studentId,
  currentTier,
  enrolledSubjects,
  defaultBoard = "edexcel",
  ownerLabel,
  level,
}: AddSubjectRowsProps) {
  const { data: packages = [] } = usePackages(level);
  const add = useAddSubjects();
  const { coverage } = useCurriculumCoverage();
  const [open, setOpen] = useState<string | null>(null);
  const [boards, setBoards] = useState<Record<string, BoardV>>({});

  const cadence = planCadence(currentTier);
  const currentCount = planSubjectCount(currentTier);
  const remaining = PLAN_MAX_SUBJECTS - enrolledSubjects.length;

  /** Boards that teach this subject at the student's level; none while unknown. */
  const boardsFor = (subject: string): BoardV[] =>
    isLevel(level) && isSubject(subject) ? coverage.boardsForSubject(level, subject) : [];

  /** The board a new subject starts on: the student's own, if it teaches it here. */
  const startingBoard = (subject: string): BoardV => {
    const options = boardsFor(subject);
    return options.includes(defaultBoard) ? defaultBoard : (options[0] ?? defaultBoard);
  };

  // Only subjects with a spec at this level are for sale. This fails closed —
  // nothing is offered while coverage loads or if it can't be read — because a
  // subject sold with no curriculum behind it is a paid, empty app. It is what
  // stopped an iGCSE student buying Physics, which has no iGCSE spec yet.
  const available = SUBJECTS.filter(
    (s) => !enrolledSubjects.includes(s.value) && boardsFor(s.value).length > 0,
  );

  // Nothing to sell — no tiles at all.
  if (!cadence || available.length === 0 || remaining <= 0) return null;

  const priceOf = (tier: string) => packages.find((p) => p.tier === tier)?.price_pence ?? null;
  const unit = CADENCES.find((c) => c.key === cadence)?.unit ?? "";
  const newCount = enrolledSubjects.length + 1;
  const nowPrice = priceOf(tierFor(cadence, currentCount));
  const nextPrice = priceOf(tierFor(cadence, newCount));
  const delta = nowPrice != null && nextPrice != null ? nextPrice - nowPrice : null;
  const deltaPerWeek = delta != null ? Math.round(pricePerWeek(cadence, delta)) : null;
  // One live lesson a week per subject, so the extra lessons per billing cycle.
  const extraLessons = WEEKS_PER_CYCLE[cadence];
  const cycleWord = unit.replace(/^per /, "a ");
  // Adding the last missing subject completes the set — worth saying so.
  const completesSet = remaining === 1;
  const whose = ownerLabel ? `${ownerLabel}'s` : "your";
  // A plan already priced for more subjects than it has (bought for three,
  // two picked) adds the next one for nothing: say so, never "£0 a week".
  const alreadyPaid = delta != null && delta <= 0;
  const lessons = `${NUMBER_WORDS[extraLessons] ?? extraLessons} more live ${
    extraLessons === 1 ? "lesson" : "lessons"
  } ${cycleWord}`;
  const offerLine = alreadyPaid
    ? `${lessons}, already paid for`
    : deltaPerWeek != null && deltaPerWeek > 0
      ? `${lessons} for just ${friendlyPence(deltaPerWeek)} a week`
      : lessons;

  const submit = (subject: string, label: string) => {
    add.mutate(
      { studentId, subjects: [{ subject, board: boards[subject] ?? startingBoard(subject) }] },
      {
        onSuccess: () => {
          setOpen(null);
          toast.success(`${label} added — ${whose} access is unlocked.`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <>
      {available.map((s) => {
        const tint = SUBJECT_TINT[s.value] ?? "tint-primary";
        const boardOptions = BOARDS.filter((b) => boardsFor(s.value).includes(b.value));
        const isOpen = open === s.value;
        const board = boards[s.value] ?? startingBoard(s.value);

        return (
          <div key={s.value} className={`bill-row ${tint}`}>
            <span className="bill-dot bill-dot-empty" aria-hidden>
              {SUBJECT_EMOJI[s.value] ?? "📘"}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-bold text-[color:var(--tint)]">
                {completesSet ? `Complete your sciences with ${s.label}` : `Add ${s.label}`}
              </h3>
              <p className="font-semibold">{offerLine}</p>
            </div>
            {!isOpen && (
              <button
                type="button"
                onClick={() => setOpen(s.value)}
                className="btn-solid inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-bold"
              >
                <Plus className="size-4" aria-hidden /> Add {s.label}
              </button>
            )}

            {/* The second tap: which board, and what it costs, in full. */}
            {isOpen && (
              <div className="bill-row-more point-panel">
                {boardOptions.length > 1 && (
                  <div
                    role="group"
                    aria-label={`Exam board for ${s.label}`}
                    className="bill-boards"
                  >
                    {boardOptions.map((b) => (
                      <button
                        key={b.value}
                        type="button"
                        aria-pressed={b.value === board}
                        onClick={() => setBoards((prev) => ({ ...prev, [s.value]: b.value }))}
                        disabled={add.isPending}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                )}
                {alreadyPaid ? (
                  <p>
                    Nothing more to pay: {whose} plan already covers{" "}
                    {(NUMBER_WORDS[newCount] ?? String(newCount)).toLowerCase()} subjects.
                  </p>
                ) : (
                  delta != null &&
                  nextPrice != null && (
                    <p>
                      Adds <strong>{formatPence(delta)}</strong> {unit}
                      {deltaPerWeek != null && cadence !== "weekly" && (
                        <> — that&apos;s {friendlyPence(deltaPerWeek)} a week</>
                      )}
                      . Today you pay only for the days left in this billing period, then{" "}
                      <strong>{formatPence(nextPrice)}</strong> {unit}.
                    </p>
                  )
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => submit(s.value, s.label)}
                    disabled={add.isPending}
                    className="btn-solid inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-bold"
                  >
                    {add.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="size-4" aria-hidden />
                    )}
                    Add {s.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    disabled={add.isPending}
                    className="btn-ghost inline-flex h-11 items-center rounded-xl px-4 text-sm font-bold"
                  >
                    Not now
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
