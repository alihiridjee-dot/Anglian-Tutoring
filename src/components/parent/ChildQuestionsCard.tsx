import { QuestionLoadSummary } from "@/components/practice/QuestionLoadPicker";
import { QUESTION_LEVELS } from "@/components/practice/questionLevels";
import { SectionHeading } from "@/components/Shared";
import type { QuestionLoad } from "@/lib/practice/questionLoad";
import { cn } from "@/lib/utils";

/**
 * How many questions the child is set, read-only: the level they chose, about
 * how many minutes a day it comes to, and the two counts. It is the ring the
 * child's own profile draws under the three choices, under the same heading,
 * so a parent and child see one picture of it. Only the child changes it.
 *
 * Marks are out of the questions set, so this is also what a parent reads the
 * grades and quiz averages on the page with. It states the level and nothing
 * more: no mark or grade is changed for it.
 */
export function ChildQuestionsCard({
  load,
  topicsPerWeek,
}: {
  load: QuestionLoad;
  /** Points in the child's week, across every subject. */
  topicsPerWeek: number;
}) {
  const level = QUESTION_LEVELS[load];
  return (
    <div className="premium-card p-4 sm:p-6">
      <SectionHeading title="How many questions" />
      <p className={cn(level.tint, "mt-4 text-xl font-bold")}>
        <span aria-hidden>{level.emoji}</span> {level.name}
      </p>
      <QuestionLoadSummary load={load} topicsPerWeek={topicsPerWeek} compact className="mt-4" />
    </div>
  );
}
