import { Tally } from "@/components/planner/workbench/figures";
import { QUESTION_LEVELS } from "@/components/practice/questionLevels";
import { QUESTION_CAPS, type LoadCut, type QuestionLoad } from "@/lib/practice/questionLoad";
import { cn } from "@/lib/utils";

/**
 * A student's level as someone else reads it: its emoji and name, nothing to
 * press. A tutor sees it beside the student's name, so a quiz marked out of
 * six is not read against another student's out of eight. Only the student
 * changes it, on their profile.
 *
 * Give it the level as shown (`readLoad`), so one that is held back reads as
 * Normal here as it does for the student.
 */
export function QuestionLevelWord({ load, className }: { load: QuestionLoad; className?: string }) {
  const level = QUESTION_LEVELS[load];
  const caps = QUESTION_CAPS[load];
  return (
    <b
      className={cn("whitespace-nowrap", className)}
      title={`${caps.quiz} MCQs in each quiz, ${caps.task} written questions in each task`}
    >
      <span aria-hidden>{level.emoji}</span> <span className="sr-only">Questions: </span>
      {level.name}
    </b>
  );
}

/**
 * On a hand-in that a level cut short: the level, how many questions were set
 * and how many of the task's were left out, each count in a dot. The marks
 * are out of the questions set, so this is what a high percentage is read
 * with. Drawn only for work that was cut (`loadCut`).
 */
export function QuestionsSetLine({ cut }: { cut: LoadCut }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      {cut.load && <QuestionLevelWord load={cut.load} />}
      <Tally
        n={cut.set}
        word={cut.set === 1 ? "question set" : "questions set"}
        tint={cut.load ? QUESTION_LEVELS[cut.load].tint : undefined}
      />
      <Tally n={cut.leftOut} word="left out" tint="tint-slate" />
    </p>
  );
}
