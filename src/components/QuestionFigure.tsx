import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { checkFigure } from "@/lib/figures/figureCheck";
import type { FigureBrief } from "@/lib/figures/figure";

/**
 * A question's figure: the graph, circuit, reaction profile or food web it
 * is answered from. Shown only when the figure check passes, and then as the
 * check's own copy, rebuilt from the parsed drawing, so only the contract's
 * elements ever reach the page (lib/figures). A figure that fails shows
 * nothing at all: a wrong picture is worse than none.
 */
export function QuestionFigure({
  svg,
  alt,
  brief,
  className,
}: {
  svg: string;
  /** What the figure shows, without the answer, for a screen reader. */
  alt: string;
  /** The brief it was drawn from: its values are checked against the drawing. */
  brief?: FigureBrief;
  className?: string;
}) {
  const check = useMemo(() => checkFigure(svg, brief), [svg, brief]);
  if (check.problems.length || !check.svg) return null;
  return (
    <figure
      className={cn(
        // Little padding on a phone: every pixel goes to the drawing's labels.
        "rounded-2xl bg-[color-mix(in_oklab,var(--tint)_5%,var(--card))] p-1.5 sm:p-4",
        className,
      )}
    >
      {/* The drawing is the check's rebuilt copy, never the model's text. */}
      <div role="img" aria-label={alt} dangerouslySetInnerHTML={{ __html: check.svg }} />
    </figure>
  );
}
