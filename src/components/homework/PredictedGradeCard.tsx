import type { CSSProperties, ReactNode } from "react";
import { Target, TrendingUp } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { Confetti, Sparkles } from "@/components/Doodles";
import { Ring } from "@/components/Shared";
import { cn } from "@/lib/utils";
import { useSetTargetGrade } from "@/hooks/data/useEnrolments";
import { gradeOptions } from "@/lib/auth/onboarding";
import { subjectLabel, subjectTint } from "@/lib/curriculum/subjectTheme";
import type { LevelV, SubjectV } from "@/lib/curriculum/taxonomy";
import {
  gradeFill,
  gradesToGo,
  hasPrediction,
  type SubjectAnalytics,
} from "@/lib/profile/analytics";

/**
 * The predicted grade for the subject the header slider is on: where the
 * student is aiming, beside where their marked work says they are heading.
 *
 * It used to be a row of cards, one per subject, each with a bare "Grade 7" —
 * no target to read it against, and on a page that is otherwise about one
 * subject. Now it is one subject, two rings: the target (paler: the goal) and
 * the live prediction (solid: the progress), each filled by how far up the
 * scale its grade sits, so the gap between them is visible before it is read.
 *
 * Nothing else is on the card: no heading (the header slider names the
 * subject) and no averages. Once both grades exist, one chip under the rings
 * says whether the student is on target or how many grades are left. The
 * prediction waits for `MIN_WORK_FOR_PREDICTION` pieces of scored work; until
 * then its ring is a dash. A-Level has no calibrated letter yet (see
 * `GradePredictorCard`), so its ring stays a dash.
 *
 * The rings have a little life, all of it the kit's own motion: on arrival
 * each sweeps in, its number pops and a sparkle glitters in beside it; on a
 * computer a ring hops when the pointer reaches it; and when Working towards
 * reaches the target, that ring cheers with a burst of confetti. The entrance
 * plays once — keyed by subject where it is used, so it plays again on a
 * switch — and nothing loops.
 */
export function PredictedGradeCard({
  subject,
  row,
  level,
  targetGrade,
  studentId,
}: {
  subject: string;
  /** This subject's averages; undefined while they load. */
  row: SubjectAnalytics | undefined;
  level: LevelV | null;
  targetGrade: string | null;
  /** The signed-in student, who may set a missing target. Null in the showcase. */
  studentId: string | null;
}) {
  const scale = gradeOptions(level);
  const predicts = level !== "alevel";
  const working = predicts && row && hasPrediction(row) ? String(row.predictedGrade) : null;
  const toGo = gradesToGo(working, targetGrade, scale);

  return (
    <div
      className={`premium-card inline-flex max-w-full flex-col items-center gap-5 p-5 sm:p-6 ${subjectTint(subject)}`}
    >
      <div className="flex flex-wrap items-start justify-center gap-8 sm:gap-10">
        <GradeRing
          label="Target"
          grade={targetGrade}
          fill={gradeFill(targetGrade, scale)}
          soft
          sparkle={{ className: "-right-3 -top-1", delay: "1s" }}
        >
          {!targetGrade && studentId && (
            <TargetPicker subject={subject} scale={scale} studentId={studentId} />
          )}
        </GradeRing>
        <GradeRing
          label="Working towards"
          grade={working}
          fill={gradeFill(working, scale)}
          sparkle={{ className: "-bottom-1 -left-3", delay: "1.15s" }}
          celebrate={toGo !== null && toGo <= 0}
        />
      </div>
      {toGo !== null &&
        (toGo <= 0 ? (
          <span className="chip chip-solid">
            <Target className="size-3.5" aria-hidden /> On target
          </span>
        ) : (
          <span className="chip">
            <TrendingUp className="size-3.5" aria-hidden /> {toGo} grade
            {toGo === 1 ? "" : "s"} to go
          </span>
        ))}
    </div>
  );
}

function GradeRing({
  label,
  grade,
  fill,
  soft = false,
  sparkle,
  celebrate = false,
  children,
}: {
  label: string;
  grade: string | null;
  fill: number;
  soft?: boolean;
  /** Where this ring's sparkle lands, and when it glitters in. */
  sparkle: { className: string; delay: string };
  /** Reached the target: the ring cheers and confetti falls once its sweep lands. */
  celebrate?: boolean;
  children?: ReactNode;
}) {
  // The rest of the motion folds flat in CSS; confetti that can't fall would
  // sit on the ring as stray shards, so it is left out instead.
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex flex-col items-center gap-2.5">
      {/* The hop (on hover) and the cheer (once) sit on separate wrappers: on
          one element, every hover-out would restart the cheer. Keyed by the
          grade so a newly set target plays the whole entrance again. */}
      <div key={grade ?? "none"} className="ring-hop">
        <div
          className={celebrate ? "cheer" : undefined}
          style={celebrate ? { animationDelay: "1.05s" } : undefined}
        >
          <Ring value={fill} size={116} stroke={11} soft={soft}>
            <span
              className={`numeral pop-in text-4xl ${grade && !soft ? "text-[color:var(--tint)]" : "text-foreground"}`}
              style={{ "--pop-delay": "0.85s" } as CSSProperties}
            >
              {grade ?? "—"}
            </span>
            {grade && (
              <Sparkles
                className={cn("glitter-dot absolute size-5", sparkle.className)}
                style={{ "--glitter-delay": sparkle.delay } as CSSProperties}
              />
            )}
            {celebrate && !reduceMotion && <Confetti delay="1.05s" />}
          </Ring>
        </div>
      </div>
      <span className="eyebrow eyebrow-bare">{label}</span>
      {children}
    </div>
  );
}

/**
 * A missing target, set from the card. Writes the same field sign-up asked for
 * and the tutor edits, so this only fills a gap; changing a target that exists
 * stays with the tutor.
 */
function TargetPicker({
  subject,
  scale,
  studentId,
}: {
  subject: string;
  scale: string[];
  studentId: string;
}) {
  const setTarget = useSetTargetGrade();
  return (
    <select
      aria-label={`Set your ${subjectLabel(subject)} target grade`}
      value=""
      disabled={setTarget.isPending}
      onChange={(e) => {
        const targetGrade = e.target.value;
        if (!targetGrade) return;
        setTarget.mutate(
          { studentId, subject: subject as SubjectV, targetGrade },
          {
            onSuccess: () =>
              toast.success(`${subjectLabel(subject)} target set to ${targetGrade}.`),
            onError: (err) =>
              toast.error(err instanceof Error ? err.message : "Couldn't save that — try again."),
          },
        );
      }}
      className="premium-input h-11 cursor-pointer rounded-full px-3.5 text-sm font-bold sm:pointer-fine:h-9"
    >
      <option value="">Set target</option>
      {/* Nobody aims for a U. */}
      {scale
        .filter((g) => g !== "U")
        .map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
    </select>
  );
}
