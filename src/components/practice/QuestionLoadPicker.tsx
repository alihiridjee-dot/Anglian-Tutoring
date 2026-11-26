import { ChoiceTile } from "@/components/onboarding/StepCard";
import { TINT_TEXT } from "@/components/planner/workbench/figures";
import { Ring } from "@/components/Shared";
import {
  QUESTION_CAPS,
  QUESTION_LOADS,
  minutesPerDay,
  type QuestionLoad,
} from "@/lib/practice/questionLoad";
import { cn } from "@/lib/utils";

/**
 * Reduced, Normal or Enhanced: how many of a point's questions a student sees.
 * The sign-up step and the profile card both draw this, so the three choices
 * read the same wherever they are made.
 *
 * Three plain tiles, and under them one ring for the tile that is picked: the
 * minutes a day inside it, filled as far as its share of the heaviest level,
 * with what the level means beside it. No figure is loose: the minutes sit in
 * the ring and each count in a dot. Ali picked this look (C, "the dial") from
 * three on 26 Nov 2026.
 */
const LEVELS: Record<QuestionLoad, { name: string; emoji: string; tint: string }> = {
  reduced: { name: "Reduced", emoji: "🪶", tint: "tint-accent" },
  normal: { name: "Normal", emoji: "🎯", tint: "tint-primary" },
  enhanced: { name: "Enhanced", emoji: "🚀", tint: "tint-amber" },
};

export function QuestionLoadPicker({
  value,
  onChange,
  topicsPerWeek,
}: {
  value: QuestionLoad;
  onChange: (load: QuestionLoad) => void;
  /** Points in a week, across every subject: what the minutes are worked from. */
  topicsPerWeek: number;
}) {
  const caps = QUESTION_CAPS[value];
  const minutes = minutesPerDay(value, topicsPerWeek);
  // Full on the heaviest level, so the three compare as the ring moves.
  const share = (minutes / minutesPerDay("enhanced", topicsPerWeek)) * 100;
  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {QUESTION_LOADS.map((load) => {
          const level = LEVELS[load];
          return (
            <div key={load} className={level.tint}>
              <ChoiceTile
                title={`${level.emoji} ${level.name}`}
                selected={value === load}
                onClick={() => onChange(load)}
              />
            </div>
          );
        })}
      </div>
      <div
        className={cn(
          "mt-6 flex flex-wrap items-center gap-x-6 gap-y-4 text-lg",
          LEVELS[value].tint,
        )}
      >
        <span className="flex items-center gap-2.5 leading-tight font-bold">
          About
          <Ring key={value} value={share} size={80} stroke={9} className="shrink-0">
            <span className={cn("numeral pop-in text-[1.7rem]", TINT_TEXT)}>{minutes}</span>
          </Ring>
          minutes a day
        </span>
        <div key={value} className="point-panel grid gap-2.5 text-[1.0625rem] font-bold">
          <Count n={caps.quiz} word="MCQs in each quiz" />
          <Count n={caps.task} word="written questions in each task" />
        </div>
      </div>
    </div>
  );
}

/** A count, inside a solid dot in its level's colour, the plain word beside it. */
function Count({ n, word }: { n: number; word: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="qload-count numeral">{n}</span>
      {word}
    </span>
  );
}
