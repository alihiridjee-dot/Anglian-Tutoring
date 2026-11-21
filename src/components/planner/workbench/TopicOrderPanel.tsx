import { Check, SlidersHorizontal } from "lucide-react";
import { Meter } from "@/components/Shared";
import { cn } from "@/lib/utils";
import { CTRL } from "./figures";
import type { TopicRow } from "./gridData";
import { Panel } from "./PlanGrid";

/**
 * The topics in the order they will be taught: each in a numbered dot, with its
 * weeks under its name, a tick on the ones gone by and "Now" on the one being
 * taught. The button opens the order editor, where the order is changed and
 * the new dates are seen before anything is saved.
 */
export function TopicOrderPanel({
  topics,
  percent,
  onChange,
}: {
  topics: TopicRow[];
  /** How much of the course is covered. */
  percent: number;
  /** Null while the order can't be changed: a re-plan is waiting to apply. */
  onChange: (() => void) | null;
}) {
  if (topics.length === 0) return null;
  return (
    <Panel
      id="workbench-order"
      title="Topic order"
      aside={
        onChange && (
          <button type="button" className={CTRL} onClick={onChange}>
            <SlidersHorizontal className="size-4" aria-hidden /> Change order
          </button>
        )
      }
    >
      <div className="px-3 pt-2">
        <Meter value={percent} size="sm" />
      </div>
      <ol className="text-sm">
        {topics.map((topic, i) => (
          <li key={topic.topicId} className="flex items-center gap-2 px-3 py-1.5">
            <span
              className={cn(
                "numeral grid size-7 shrink-0 place-items-center rounded-full text-xs",
                topic.state === "now"
                  ? "bg-[var(--tint)] text-white"
                  : "bg-[color-mix(in_oklab,var(--tint)_18%,var(--card))]",
              )}
            >
              {topic.state === "done" ? (
                <Check className="size-3.5" strokeWidth={3.5} aria-label="Done" />
              ) : (
                i + 1
              )}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block">{topic.title}</b>
              {topic.when}
              {topic.state === "now" && <b> · Now</b>}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
