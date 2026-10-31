/**
 * A longitudinal wave, drawn the same size every time: a row of vertical
 * lines, like the coils of a slinky or layers of air, each moved from an even
 * spacing by a sine, so two whole waves of compressions and rarefactions show
 * across it. Lettered arrows mark a compression and a rarefaction from above,
 * and a wavelength (compression to compression) from below; the checker
 * holds every line to its place and each letter to its own feature.
 */
import type { Pt } from "../figureCheck";
import { and } from "../figureSvg";
import type { FigureKind } from "./kind";
import { drawParts, partProblems, type Part } from "./parts";

export const LONGITUDINAL_SPANS = ["compression", "rarefaction", "wavelength"] as const;
type Shows = (typeof LONGITUDINAL_SPANS)[number];

export type LongitudinalBrief = {
  kind: "longitudinal-wave";
  arrows: { shows: Shows; letter: string }[];
};

const H = 240;
/**
 * The row: lines `spacing` apart at rest from `left`, two wavelengths long,
 * each moved along by `shift` × sin(2π u / wavelength). The shift's slope is
 * 0.6, so the lines bunch to 4 units apart at a compression and spread to 16
 * at a rarefaction, and never cross.
 */
export const COILS = {
  left: 30,
  spacing: 10,
  wavelength: 150,
  shift: (0.6 * 150) / (2 * Math.PI),
  top: 100,
  bottom: 172,
} as const;
/** Each line's x: rarefactions at both ends and in the middle, compressions a quarter of the way in from each end. */
export const coilXs = () =>
  Array.from({ length: (2 * COILS.wavelength) / COILS.spacing + 1 }, (_, i) => {
    const u = i * COILS.spacing;
    return COILS.left + u + COILS.shift * Math.sin((2 * Math.PI * u) / COILS.wavelength);
  });
/** Where each feature is: the first compression, the middle rarefaction, and the first compression to the second. */
const AT = {
  compression: COILS.left + COILS.wavelength / 2,
  rarefaction: COILS.left + COILS.wavelength,
  next: COILS.left + (3 * COILS.wavelength) / 2,
} as const;
const ABOVE = { tail: 52, tip: COILS.top - 8, letter: 44 } as const;
const BELOW = { arrow: 196, letter: 220 } as const;

/** The whole figure as parts, every position fixed. */
function layout(b: LongitudinalBrief): Part[] {
  const parts: Part[] = coilXs().map((x, i, all) => ({
    what: `line ${i + 1} of ${all.length}`,
    el: "line",
    cls: "qf-line",
    pts: [
      [x, COILS.top],
      [x, COILS.bottom],
    ],
  }));
  for (const a of b.arrows) {
    if (a.shows === "wavelength") {
      const ends: Pt[] = [
        [AT.compression, BELOW.arrow],
        [AT.next, BELOW.arrow],
      ];
      parts.push(
        {
          what: "wavelength arrow (from one compression to the next)",
          el: "line",
          cls: "qf-line",
          pts: [ends[0], ends[1]],
          heads: "both",
        },
        ...ends.map(([x], i): Part => ({
          what: `guide line under the ${i ? "second" : "first"} compression`,
          el: "line",
          cls: "qf-thin",
          pts: [
            [x, COILS.bottom + 6],
            [x, BELOW.arrow + 6],
          ],
        })),
        {
          what: "wavelength arrow's letter",
          el: "text",
          cls: "qf-strong",
          pts: [[(AT.compression + AT.next) / 2, BELOW.letter]],
          anchor: "middle",
          lines: [a.letter],
        },
      );
      continue;
    }
    const x = AT[a.shows];
    parts.push(
      {
        what: `arrow pointing down at the ${a.shows}`,
        el: "line",
        cls: "qf-line",
        pts: [
          [x, ABOVE.tail],
          [x, ABOVE.tip],
        ],
        heads: "end",
      },
      {
        what: `${a.shows} arrow's letter`,
        el: "text",
        cls: "qf-strong",
        pts: [[x, ABOVE.letter]],
        anchor: "middle",
        lines: [a.letter],
      },
    );
  }
  return parts;
}

const LETTER = /^[A-Z]$/;

export const longitudinalWave: FigureKind<LongitudinalBrief> = {
  kind: "longitudinal-wave",
  name: "a longitudinal wave",
  guide:
    'arrows: 1 to 3 {shows: "compression", "rarefaction" or "wavelength" (from one compression to the next), letter: one capital letter}, each shows once. The website draws the same row of lines every time, like the coils of a slinky or layers of air, bunched into compressions and spread into rarefactions over two whole waves, and marks a compression and a rarefaction with arrows from above and the wavelength with a double arrow below.',
  read(b) {
    const arrows = b.arrows as { shows: unknown; letter: unknown }[];
    if (!Array.isArray(arrows) || arrows.length < 1 || arrows.length > 3)
      return { problem: "needs 1 to 3 arrows" };
    const read: LongitudinalBrief = { kind: "longitudinal-wave", arrows: [] };
    for (const a of arrows) {
      if (!LONGITUDINAL_SPANS.includes(a?.shows as Shows))
        return {
          problem: 'has an arrow that does not show "compression", "rarefaction" or "wavelength"',
        };
      const letter = typeof a.letter === "string" ? a.letter.trim() : "";
      if (!LETTER.test(letter)) return { problem: "needs one capital letter for each arrow" };
      read.arrows.push({ shows: a.shows as Shows, letter });
    }
    if (
      new Set(read.arrows.map((a) => a.shows)).size !== read.arrows.length ||
      new Set(read.arrows.map((a) => a.letter)).size !== read.arrows.length
    )
      return { problem: "has two arrows showing the same thing, or sharing a letter" };
    return { brief: read };
  },
  draw(b) {
    const above = b.arrows.filter((a) => a.shows !== "wavelength").map((a) => a.letter);
    const below = b.arrows.find((a) => a.shows === "wavelength");
    return {
      svg: drawParts(H, layout(b)),
      // Which letter marks which feature is the question: only where each arrow is.
      alt: `A row of ${coilXs().length} vertical lines, like the coils of a stretched spring, bunched close together in some places and spread apart in others.${above.length ? ` ${above.length === 1 ? "An arrow above the lines points down at them, labelled" : "Two arrows above the lines point down at them, labelled"} ${and(above)}.` : ""}${below ? ` A double-headed arrow under the lines, labelled ${below.letter}, spans part of the row.` : ""}`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    if (d.H !== H) out.push(`The canvas is ${d.H} high; the wave is ${H}`);
    const lines = d.shapes.filter((s) => s.name === "line" && s.cls === "qf-line" && !s.marked);
    if (lines.length !== coilXs().length)
      out.push(`The row has ${lines.length} lines; the wave has ${coilXs().length}`);
    out.push(...partProblems(layout(b), d, t));
    return out;
  },
  samples: [
    {
      subject: "physics",
      question:
        "The diagram shows a longitudinal wave travelling along a slinky spring. Which letter labels a compression?",
      options: ["A", "B", "C"],
      brief: {
        kind: "longitudinal-wave",
        arrows: [
          { shows: "rarefaction", letter: "A" },
          { shows: "compression", letter: "B" },
          { shows: "wavelength", letter: "C" },
        ],
      },
    },
    {
      subject: "physics",
      question:
        "The diagram shows a sound wave travelling through air as layers of air particles. Name the part of the wave labelled P. The sound has a frequency of 680 Hz and travels at 340 m/s. Calculate the distance labelled Q.",
      brief: {
        kind: "longitudinal-wave",
        arrows: [
          { shows: "rarefaction", letter: "P" },
          { shows: "wavelength", letter: "Q" },
        ],
      },
    },
  ],
  random(r) {
    const n = 1 + Math.floor(r() * 3);
    const arrows = Array.from({ length: n }, (_, i) => ({
      // Now and then one shown twice, which read refuses.
      shows: LONGITUDINAL_SPANS[r() < 0.1 ? 0 : (i + Math.floor(r() * 3)) % 3],
      letter: "PQRS"[i],
    }));
    return { kind: "longitudinal-wave", arrows };
  },
};
