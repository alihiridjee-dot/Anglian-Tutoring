import { highlight } from "@/lib/search/match";

/**
 * Renders `text` with the matched terms emphasised.
 *
 * Emphasis is a background tint rather than bold, so a match inside an already
 * semibold title still reads as a match.
 */
export function Highlight({
  text,
  terms,
  className,
}: {
  text: string;
  terms: string[];
  className?: string;
}) {
  const segments = highlight(text, terms);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark key={i} className="bg-primary/20 text-primary rounded-[3px] px-0.5 py-px">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}
