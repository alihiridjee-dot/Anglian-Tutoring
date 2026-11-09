/**
 * An equation's formula with arrows: each label sits above or below and an
 * arrow runs from it to the characters it names, highlighted, so a student
 * sees which 2 in 2H₂O is which without reading a sentence about it.
 *
 * The formula is drawn as text, as every other formula is, then measured: the
 * labels are packed so none overlap (arrowLayout.ts) and the arrows drawn
 * round it. Where no arrow can reach a part without crossing text (a long
 * formula wrapped onto three lines), or the page's text doesn't match the
 * formula, the labels become a short list under it instead.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SciText } from "@/components/Shared";
import { sciRuns, toSciNotation } from "@/lib/platform/sciNotation";
import { arrowSpan, type EquationArrow } from "@/lib/notes/noteFormat";
import {
  arrowPath,
  arrowSides,
  arrowStartX,
  packLabels,
  type PartScript,
} from "@/lib/notes/arrowLayout";

/** Room for the arrow between the nearest labels and the formula. */
const ARROW_ROOM = 30;
const LINE_GAP = 8;
/** How far the highlight stands off its characters. */
const PAD = 2;

const INK = "text-[color-mix(in_oklab,var(--tint)_75%,var(--foreground))]";

type Box = { x: number; y: number; w: number; h: number };
type Drawn = {
  above: number;
  below: number;
  labels: { x: number; y: number }[];
  marks: Box[];
  paths: string[];
};

/** A DOM range over characters [start, end) of an element's text. */
function rangeOver(root: Node, start: number, end: number): Range | null {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let started = false;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const len = n.nodeValue?.length ?? 0;
    if (!started && start < pos + len) {
      range.setStart(n, start - pos);
      started = true;
    }
    if (started && end <= pos + len) {
      range.setEnd(n, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

/** The labels as a plain list under the formula: the same words, no arrows. */
function LabelList({ arrows }: { arrows: EquationArrow[] }) {
  return (
    <ul className="mx-auto mt-3 max-w-md space-y-1 text-left text-base">
      {arrows.map((a, i) => (
        <li key={i}>
          <b className={INK}>
            <SciText text={a.point} />
          </b>
          {": "}
          <SciText text={a.label} />
        </li>
      ))}
    </ul>
  );
}

export function LabelledFormula({
  formula,
  arrows,
  className,
}: {
  formula: string;
  arrows: EquationArrow[];
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLParagraphElement>(null);
  const tags = useRef<(HTMLSpanElement | null)[]>([]);
  const [drawn, setDrawn] = useState<Drawn | "list" | null>(null);
  const head = `arrowhead${useId().replace(/:/g, "")}`;

  // Each arrow's characters, and whether they are small and low, small and high, or neither.
  const parts = useMemo(() => {
    const shown = toSciNotation(formula);
    // The page draws `shown`; the arrows count characters in `formula`, so they must line up.
    if (shown.length !== formula.length) return null;
    const out = arrows.map((a) => {
      const span = arrowSpan(formula, a);
      if ("problem" in span) return null;
      const runs = sciRuns(shown.slice(span.start, span.end));
      const script: PartScript = runs.every((r) => r.kind === "sub")
        ? "sub"
        : runs.every((r) => r.kind === "sup")
          ? "sup"
          : "plain";
      return { ...span, script };
    });
    return out.every((p) => p != null) ? out : null;
  }, [formula, arrows]);

  useLayoutEffect(() => {
    const el = box.current;
    const f = text.current;
    if (!parts || !el || !f) return;
    const expected = sciRuns(formula)
      .map((r) => r.text)
      .join("");
    const show = (next: Drawn | "list") =>
      setDrawn((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));

    const measure = () => {
      if (f.textContent !== expected) return show("list");
      const width = el.clientWidth;
      const fr = f.getBoundingClientRect();
      const style = getComputedStyle(f);
      const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      const lines = Math.max(1, Math.round(fr.height / lh));
      const marks: Box[] = [];
      const onLine: number[] = [];
      for (const p of parts) {
        const r = rangeOver(f, p.start, p.end)?.getClientRects()[0];
        if (!r) return show("list");
        const m = { x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height };
        marks.push(m);
        onLine.push(Math.min(lines - 1, Math.max(0, Math.floor((m.y + m.h / 2) / lh))));
      }
      const sides = arrowSides(
        parts.map((p, i) => ({ ...p, line: onLine[i] })),
        lines,
      );
      if (!sides) return show("list");

      // A raised or lowered number (²³⁸, ₉₂) can stand out past the line, so
      // the labels are measured from the highest and lowest highlight.
      const lift = Math.max(0, ...marks.map((m) => PAD - m.y));
      const sink = Math.max(0, ...marks.map((m) => m.y + m.h + PAD - fr.height));
      const sizes = tags.current.map((t) => ({ w: t?.offsetWidth ?? 0, h: t?.offsetHeight ?? 0 }));
      const zone = { above: lift, below: sink };
      const placed: { x: number; near: number }[] = [];
      for (const side of ["above", "below"] as const) {
        const mine = parts.map((_, i) => i).filter((i) => sides[i] === side);
        if (!mine.length) continue;
        const packed = packLabels(
          width,
          mine.map((i) => ({ cx: marks[i].x + marks[i].w / 2, w: sizes[i].w })),
        );
        const lineH: number[] = [];
        packed.forEach((p, k) => (lineH[p.line] = Math.max(lineH[p.line] ?? 0, sizes[mine[k]].h)));
        const near: number[] = [];
        let d = zone[side] + ARROW_ROOM;
        lineH.forEach((h, line) => {
          near[line] = d;
          d += h + LINE_GAP;
        });
        zone[side] = d - LINE_GAP;
        packed.forEach((p, k) => (placed[mine[k]] = { x: p.x, near: near[p.line] }));
      }

      const top = zone.above;
      const bottom = zone.above + fr.height;
      const next: Drawn = { ...zone, labels: [], marks: [], paths: [] };
      parts.forEach((_, i) => {
        const m = marks[i];
        const { w, h } = sizes[i];
        const cx = m.x + m.w / 2;
        const mark = { x: m.x - PAD, y: top + m.y - PAD, w: m.w + PAD * 2, h: m.h + PAD * 2 };
        const sx = arrowStartX({ x: placed[i].x, w }, cx);
        if (sides[i] === "above") {
          const labelBottom = top - placed[i].near;
          next.labels.push({ x: placed[i].x, y: labelBottom - h });
          next.paths.push(arrowPath({ x: sx, y: labelBottom + 3 }, { x: cx, y: mark.y - 2 }));
        } else {
          const labelTop = bottom + placed[i].near;
          next.labels.push({ x: placed[i].x, y: labelTop });
          next.paths.push(arrowPath({ x: sx, y: labelTop - 3 }, { x: cx, y: mark.y + mark.h + 2 }));
        }
        next.marks.push(mark);
      });
      const round = (n: number) => Math.round(n * 2) / 2;
      show(JSON.parse(JSON.stringify(next, (_, v) => (typeof v === "number" ? round(v) : v))));
    };

    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
      watch.disconnect();
    };
  }, [formula, parts]);

  const formulaText = (
    <p ref={text} className={className}>
      <SciText text={formula} />
    </p>
  );

  if (!parts)
    return (
      <div>
        {formulaText}
        <LabelList arrows={arrows} />
      </div>
    );

  const arrowsDrawn = drawn && drawn !== "list" ? drawn : null;
  return (
    <div>
      <div
        ref={box}
        className={`relative ${INK}`}
        style={{ paddingTop: arrowsDrawn?.above ?? 0, paddingBottom: arrowsDrawn?.below ?? 0 }}
      >
        {arrowsDrawn ? (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <defs>
              <marker
                id={head}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M1.5 1.5L8.5 5L1.5 8.5" strokeWidth={1.75} />
              </marker>
            </defs>
            {arrowsDrawn.marks.map((r, i) => (
              <rect
                key={i}
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={6}
                stroke="none"
                className="fill-[color-mix(in_oklab,var(--tint)_24%,transparent)]"
              />
            ))}
            {arrowsDrawn.paths.map((d, i) => (
              <path key={i} d={d} markerEnd={`url(#${head})`} />
            ))}
          </svg>
        ) : null}
        {/* After the highlights, so the formula is drawn over them. */}
        <div className="relative text-foreground">{formulaText}</div>
        {arrows.map((a, i) => {
          const at = arrowsDrawn?.labels[i];
          return (
            <span
              key={i}
              ref={(el) => {
                tags.current[i] = el;
              }}
              aria-hidden={at ? undefined : true}
              className="font-display absolute left-0 top-0 max-w-[min(17rem,60%)] text-balance text-center text-[15px] font-bold leading-snug sm:text-base"
              style={
                at ? { transform: `translate(${at.x}px, ${at.y}px)` } : { visibility: "hidden" }
              }
            >
              <span className="sr-only">{`Arrow to ${a.point}${a.in ? ` in ${a.in}` : ""}: `}</span>
              <SciText text={a.label} />
            </span>
          );
        })}
      </div>
      {drawn === "list" ? <LabelList arrows={arrows} /> : null}
    </div>
  );
}
