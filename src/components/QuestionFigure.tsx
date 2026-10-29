import { useMemo } from "react";
import { ZoomableFigure } from "@/components/notes/ZoomableFigure";
import { CANVAS_WIDTH, type FigureBrief } from "@/lib/figures/figure";
import { checkFigure, cleanFigure } from "@/lib/figures/figureCheck";

/**
 * A drawing on the page, as the notes show theirs: tap it for full size, where
 * its labels read at the size they were drawn. `svg` is always a rebuilt copy,
 * parsed down to the contract's elements (lib/figures), never a model's text.
 */
function Drawing({ svg, alt, className }: { svg: string; alt: string; className?: string }) {
  return (
    <figure className={className}>
      <ZoomableFigure label={alt} naturalWidth={CANVAS_WIDTH}>
        <div role="img" aria-label={alt} dangerouslySetInnerHTML={{ __html: svg }} />
      </ZoomableFigure>
    </figure>
  );
}

/**
 * A figure checked here, in full: the graph, circuit, reaction profile or food
 * web a question is answered from, held to its brief when there is one. A
 * figure that fails shows nothing at all: a wrong picture is worse than none.
 * The figures preview uses it; a saved figure is shown by `StoredFigure`.
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
  return <Drawing svg={check.svg} alt={alt} className={className} />;
}

/**
 * A question's saved figure as its row holds it, `{ svg, alt }`; nothing for
 * a question without one. It passed the full check against its brief when it
 * was drawn, so here it is only parsed and rebuilt, for safety: a layout rule
 * tightened later must never make a saved figure vanish from a question whose
 * text says "the graph shows". `plain` draws it without tap-to-zoom, for an
 * answer picture inside its answer's own button.
 */
export function StoredFigure({
  figure,
  className,
  plain = false,
}: {
  figure: unknown;
  className?: string;
  plain?: boolean;
}) {
  const f = figure as { svg?: unknown; alt?: unknown } | null | undefined;
  const raw = typeof f?.svg === "string" ? f.svg : null;
  const svg = useMemo(() => (raw ? cleanFigure(raw) : null), [raw]);
  if (!svg || typeof f?.alt !== "string") return null;
  if (plain)
    return (
      <span
        role="img"
        aria-label={f.alt}
        className={`block ${className ?? ""}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  return <Drawing svg={svg} alt={f.alt} className={className} />;
}
