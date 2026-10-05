import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  SUBJECTS,
  BOARDS,
  isBoard,
  isLevel,
  isSubject,
  type BoardV,
} from "@/lib/curriculum/taxonomy";
import { usePackages, useAddSubjects } from "@/hooks/data/useBilling";
import { useCurriculumCoverage } from "@/hooks/data/useCurriculumCoverage";
import { formatPence } from "@/lib/billing/billing";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import {
  planCadence,
  planSubjectCount,
  tierFor,
  CADENCES,
  PLAN_MAX_SUBJECTS,
} from "@/lib/billing/entitlements";

interface AddSubjectTilesProps {
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

/**
 * The frictionless upgrade, as tiles for the Subjects grid: one dashed tile per
 * subject that can still be added, showing what it adds to the bill. Same
 * cadence, one step up the subject-count ladder, prorated and charged now.
 *
 * Two taps, never one: the first opens the tile (board choice and the charge
 * spelled out), the second adds it. Renders nothing when there's nothing to
 * sell (plan already covers every subject, or the tier isn't one we can
 * upgrade automatically).
 */
export function AddSubjectTiles({
  studentId,
  currentTier,
  enrolledSubjects,
  defaultBoard = "edexcel",
  ownerLabel,
  level,
}: AddSubjectTilesProps) {
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
  const whose = ownerLabel ? `${ownerLabel}'s` : "your";

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

        if (open !== s.value) {
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setOpen(s.value)}
              className={`pop-card pop-card-flat pop-card-interactive flex flex-col items-start gap-3 border-dashed p-4 text-left sm:aspect-square sm:p-5 ${tint}`}
            >
              <span className="icon-tile size-8">
                <Plus className="size-4" aria-hidden />
              </span>
              <span className="font-display text-xl font-bold text-[color:var(--tint)]">
                Add {s.label}
              </span>
              {delta != null && (
                <span className="numeral mt-auto text-2xl">
                  +{formatPence(delta)} <span className="text-base">{unit}</span>
                </span>
              )}
            </button>
          );
        }

        return (
          <div
            key={s.value}
            className={`pop-card flex flex-col gap-3 p-4 sm:aspect-square sm:p-5 ${tint}`}
          >
            <h3 className="text-xl font-bold text-[color:var(--tint)]">Add {s.label}</h3>
            {boardOptions.length > 1 && (
              <select
                value={boards[s.value] ?? startingBoard(s.value)}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isBoard(next)) setBoards((prev) => ({ ...prev, [s.value]: next }));
                }}
                aria-label={`Exam board for ${s.label}`}
                className="premium-card h-11 self-start rounded-lg px-2 text-sm font-semibold focus:ring-2 focus:ring-primary/40 focus:outline-none sm:pointer-fine:h-9"
              >
                {boardOptions.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
            {delta != null && nextPrice != null && (
              <p className="text-sm">
                Adds <strong>+{formatPence(delta)}</strong> {unit}. Today you pay only for the days
                left in this billing period, then <strong>{formatPence(nextPrice)}</strong> {unit}.
              </p>
            )}
            <div className="mt-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => submit(s.value, s.label)}
                disabled={add.isPending}
                className="btn-solid inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
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
                className="btn-ghost inline-flex h-11 items-center rounded-lg px-3 text-sm sm:pointer-fine:h-9"
              >
                Not now
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
