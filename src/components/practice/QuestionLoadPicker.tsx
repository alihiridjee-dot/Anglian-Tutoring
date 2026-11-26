import { ChoiceTile } from "@/components/onboarding/StepCard";
import { TINT_TEXT } from "@/components/planner/workbench/figures";
import { QUESTION_LEVELS } from "@/components/practice/questionLevels";
import { Ring } from "@/components/Shared";
import {
  HEAVIEST_LIVE_LOAD,
  QUESTION_CAPS,
  QUESTION_LOADS,
  liveLoad,
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
 *
 * A level that is held back (`HELD_QUESTION_LOADS`, Enhanced for now) keeps
 * its tile, dimmed and saying so, as a board we can't teach yet does on the
 * first step. It can still be pressed, and pressing it gives Normal.
 */
const LEVELS = QUESTION_LEVELS;

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
  const picked = liveLoad(value);
  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {QUESTION_LOADS.map((load) => {
          const level = LEVELS[load];
          const held = liveLoad(load) !== load;
          return (
            // A grid, so the three tiles stay one height when one has a line more.
            <div key={load} className={cn("grid", level.tint, held && "opacity-55")}>
              <ChoiceTile
                title={`${level.emoji} ${level.name}`}
                description={held ? "Not available yet" : undefined}
                selected={picked === load}
                onClick={() => onChange(liveLoad(load))}
              />
            </div>
          );
        })}
      </div>
      <QuestionLoadSummary load={picked} topicsPerWeek={topicsPerWeek} className="mt-6" />
    </div>
  );
}

/**
 * What a level comes to: about how many minutes a day, inside a ring filled as
 * far as its share of the heaviest level, and the two counts in dots. The
 * picker draws it under its tiles, and a parent's portal draws the same thing
 * read-only (`ChildQuestionsCard`), so both see one picture of the level.
 *
 * In a narrow column the counts drop under the ring by themselves. `compact`
 * is for a column too narrow for the full-size ring and its words on one line.
 */
export function QuestionLoadSummary({
  load,
  topicsPerWeek,
  compact = false,
  className,
}: {
  load: QuestionLoad;
  /** Points in a week, across every subject: what the minutes are worked from. */
  topicsPerWeek: number;
  compact?: boolean;
  className?: string;
}) {
  const caps = QUESTION_CAPS[load];
  const minutes = minutesPerDay(load, topicsPerWeek);
  // Full on the heaviest level on offer, so the choices compare as the ring moves.
  const share = (minutes / minutesPerDay(HEAVIEST_LIVE_LOAD, topicsPerWeek)) * 100;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-4",
        compact ? "text-base" : "text-lg",
        LEVELS[load].tint,
        className,
      )}
    >
      <span className="flex items-center gap-2.5 leading-tight font-bold">
        About
        <Ring
          key={load}
          value={share}
          size={compact ? 64 : 80}
          stroke={compact ? 8 : 9}
          className="shrink-0"
        >
          <span className={cn("numeral pop-in", compact ? "text-2xl" : "text-[1.7rem]", TINT_TEXT)}>
            {minutes}
          </span>
        </Ring>
        minutes a day
      </span>
      <div
        key={load}
        className={cn(
          "point-panel grid gap-2.5 font-bold",
          compact ? "text-base" : "text-[1.0625rem]",
        )}
      >
        <Count n={caps.quiz} word="MCQs in each quiz" />
        <Count n={caps.task} word="written questions in each task" />
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
