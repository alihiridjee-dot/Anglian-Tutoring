import { cn } from "@/lib/utils";
import type { Facet } from "@/lib/homeworkReview";

/**
 * One row of multi-select filter toggles, each carrying the number of rows it
 * would show.
 *
 * Toggles rather than a dropdown because the job is speed: every option is one
 * click and zero menus away, and the counts answer "is it worth looking?"
 * before the click is made. Renders nothing when there is only one option —
 * a filter that cannot change the table is furniture.
 */
export function FilterChips({
  label,
  facets,
  selected,
  onToggle,
}: {
  label: string;
  facets: Facet[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  if (facets.length < 2) return null;
  return (
    <div className="flex items-center gap-2 min-w-0" role="group" aria-label={label}>
      <span className="eyebrow eyebrow-bare shrink-0 w-14">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {facets.map((f) => {
          const on = selected.has(f.value);
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              disabled={f.count === 0 && !on}
              onClick={() => onToggle(f.value)}
              className={cn(
                "chip transition cursor-pointer disabled:cursor-default disabled:opacity-40",
                on && "chip-solid",
              )}
            >
              {f.label}
              <span className={cn("numeral text-[11px]", !on && "opacity-70")}>{f.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
