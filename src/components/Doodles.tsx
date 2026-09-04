/**
 * The doodle cast, and the hand-drawn accents that go with it.
 *
 * Rules of the house, so this stays charming rather than childish:
 *
 *  1. Characters appear in EMPTY STATES, MILESTONES, the SORT flow, and as the
 *     ONE character peeking over the dashboard's headline card. Nowhere else —
 *     a planner grid with a cartoon in it stops being a tool, and the charm of
 *     the peek is that it is the only one. `<Mascot>` is the only export that
 *     draws a face.
 *  2. Everything is drawn from `currentColor` plus `--tint`, so a doodle
 *     dropped inside `.tint-bio` comes out green with no props.
 *  3. Strokes are 2.5–3 units on a 120 viewBox — the same weight as the card
 *     borders, which is what makes the illustrations look like they belong to
 *     the same printed kit rather than clip art.
 */
import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

export type Mood = "happy" | "wink" | "wow" | "sleepy" | "proud";

/**
 * Every character wears the same face, so they read as one cast.
 *
 * The open-eyed moods blink; `wink` and `sleepy` do not, because squashing an
 * eye that is already a closed curve just makes the drawing twitch.
 */
function Face({ mood = "happy", x = 60, y = 60 }: { mood?: Mood; x?: number; y?: number }) {
  const eye = "currentColor";
  const blinks = mood !== "wink" && mood !== "sleepy";
  return (
    <g transform={`translate(${x} ${y})`} stroke={eye} strokeWidth={3} strokeLinecap="round">
      {mood === "sleepy" ? (
        <>
          <path d="M-13 -3 q5 5 10 0" fill="none" />
          <path d="M3 -3 q5 5 10 0" fill="none" />
        </>
      ) : mood === "wink" ? (
        <>
          <path d="M-13 -3 q5 -6 10 0" fill="none" />
          <circle cx={8} cy={-3} r={2.6} fill={eye} stroke="none" />
        </>
      ) : (
        // One group per eye: a single group around both would squash them
        // TOWARDS EACH OTHER as well as flat, because `fill-box` takes the
        // origin from the pair's combined bounding box.
        <>
          <g className={blinks ? "blink" : undefined}>
            <circle cx={-8} cy={-4} r={mood === "wow" ? 3.2 : 2.8} fill={eye} stroke="none" />
          </g>
          <g className={blinks ? "blink" : undefined}>
            <circle cx={8} cy={-4} r={mood === "wow" ? 3.2 : 2.8} fill={eye} stroke="none" />
          </g>
        </>
      )}

      {mood === "wow" ? (
        <ellipse cx={0} cy={9} rx={4.5} ry={5.5} fill="none" />
      ) : mood === "sleepy" ? (
        <path d="M-5 9 h10" fill="none" />
      ) : (
        <path d={mood === "proud" ? "M-9 6 q9 11 18 0" : "M-8 7 q8 8 16 0"} fill="none" />
      )}

      {mood === "proud" ? (
        <>
          <path d="M-17 2 q-3 3 -1 6" fill="none" strokeWidth={2} opacity={0.5} />
          <path d="M17 2 q3 3 1 6" fill="none" strokeWidth={2} opacity={0.5} />
        </>
      ) : null}
    </g>
  );
}

export type MascotName =
  "cell" | "flask" | "bolt" | "star" | "books" | "rocket" | "owl" | "atom" | "pencil";

/**
 * When each character blinks, so a group of them never blinks in unison.
 * Fixed rather than random: the same value has to come out of the server render
 * and the client one, or React warns on every page that draws a mascot.
 */
const MASCOT_BLINK_DELAY: Record<MascotName, string> = {
  cell: "0s",
  flask: "1.7s",
  bolt: "3.1s",
  star: "0.9s",
  books: "2.4s",
  rocket: "4.2s",
  owl: "2.9s",
  atom: "1.2s",
  pencil: "3.7s",
};

const MASCOT_TINT: Record<MascotName, string> = {
  cell: "tint-bio",
  flask: "tint-chem",
  bolt: "tint-phys",
  star: "tint-pop",
  books: "tint-primary",
  rocket: "tint-accent",
  owl: "tint-amber",
  atom: "tint-phys",
  pencil: "tint-rose",
};

/**
 * A character.
 *
 * `tint` defaults to the one that suits the drawing (a cell is green, a flask
 * is violet) but any `tint-*` wrapper further up wins if you pass `inherit`.
 */
export function Mascot({
  name,
  mood = "happy",
  size = 112,
  idle = true,
  inheritTint = false,
  className,
}: {
  name: MascotName;
  mood?: Mood;
  size?: number;
  idle?: boolean;
  inheritTint?: boolean;
  className?: string;
}) {
  const fill = "color-mix(in oklab, var(--tint) 26%, white)";
  const deep = "color-mix(in oklab, var(--tint) 55%, white)";

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="presentation"
      aria-hidden
      className={cn(
        "shrink-0 text-[color:var(--foreground)]",
        !inheritTint && MASCOT_TINT[name],
        idle && "idle-tilt",
        className,
      )}
      style={{ "--blink-delay": MASCOT_BLINK_DELAY[name] } as React.CSSProperties}
    >
      <g
        stroke="currentColor"
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      >
        {name === "cell" ? (
          <>
            {/* wobbly membrane — deliberately not a circle */}
            <path
              d="M60 14c22 0 44 16 44 42 0 28-20 50-44 50S16 84 16 56C16 30 38 14 60 14Z"
              fill={fill}
            />
            <path d="M60 22c18 0 36 13 36 34" stroke="white" strokeWidth={4} opacity={0.55} />
            <circle cx={86} cy={40} r={7} fill={deep} />
            <circle cx={30} cy={78} r={5} fill={deep} />
            <Face mood={mood} y={62} />
            <path d="M104 56c5-2 9-1 12 2M4 62c-4-3-4-8-2-11" strokeWidth={2.5} />
          </>
        ) : null}

        {name === "flask" ? (
          <>
            <path
              d="M48 16h24M52 16v26L26 92a10 10 0 0 0 9 15h50a10 10 0 0 0 9-15L68 42V16"
              fill="white"
            />
            <path d="M39 70h42l14 22a10 10 0 0 1-9 15H34a10 10 0 0 1-9-15Z" fill={fill} />
            <circle cx={34} cy={98} r={3.5} fill={deep} />
            <circle cx={88} cy={98} r={2.5} fill={deep} />
            {/* The face sits in the WIDE part of the cone. Higher up it lands on
                the neck, where the eyes straddle the two glass edges and the
                whole thing stops reading as a face. */}
            <Face mood={mood} y={78} />
            <path d="M84 24c3-5 9-5 12 0M92 12v4" strokeWidth={2.5} opacity={0.6} />
          </>
        ) : null}

        {name === "bolt" ? (
          <>
            <path d="M66 8 24 66h26l-8 46 46-62H60l8-42Z" fill={fill} />
            <Face mood={mood} x={54} y={62} />
            <path d="M100 30c5 2 8 7 8 12M14 96c-5-2-8-7-8-12" strokeWidth={2.5} opacity={0.55} />
          </>
        ) : null}

        {name === "star" ? (
          <>
            <path
              d="M60 10 74 44l37 3-28 24 9 36-32-19-32 19 9-36-28-24 37-3Z"
              fill="color-mix(in oklab, var(--pop) 70%, white)"
            />
            <Face mood={mood} y={58} />
            <path d="M104 18l3-8 3 8 8 3-8 3-3 8-3-8-8-3Z" fill={deep} strokeWidth={2} />
          </>
        ) : null}

        {name === "books" ? (
          <>
            <rect x={18} y={74} width={84} height={20} rx={5} fill={fill} />
            <rect x={24} y={54} width={72} height={20} rx={5} fill="white" />
            <rect x={14} y={34} width={82} height={20} rx={5} fill={deep} />
            <path d="M32 84h14M38 64h14M28 44h14" strokeWidth={2.5} opacity={0.6} />
            <Face mood={mood} x={62} y={16} />
            {mood === "sleepy" ? (
              <path
                d="M92 26h10l-10 12h10M104 10h7l-7 8h7"
                strokeWidth={2.5}
                opacity={0.65}
                fill="none"
              />
            ) : null}
          </>
        ) : null}

        {name === "rocket" ? (
          <>
            <path d="M60 8c16 14 22 32 22 50v14H38V58c0-18 6-36 22-50Z" fill={fill} />
            <path d="M38 60 20 78l6 16 12-10M82 60l18 18-6 16-12-10" fill="white" />
            <circle cx={60} cy={44} r={11} fill="white" />
            <Face mood={mood} y={44} />
            <path
              d="M50 86c4 10 4 18 10 26 6-8 6-16 10-26"
              fill="color-mix(in oklab, var(--pop) 65%, white)"
            />
          </>
        ) : null}

        {name === "owl" ? (
          <>
            {/* Ears are part of the head outline rather than two stuck-on
                triangles — a single path is what keeps it a drawing. */}
            <path
              d="M30 40c-4-10-3-20 2-24 6 5 10 9 12 14M90 40c4-10 3-20-2-24-6 5-10 9-12 14"
              fill={fill}
            />
            <path
              d="M60 22c22 0 34 18 34 40 0 26-15 44-34 44S26 88 26 62c0-22 12-40 34-40Z"
              fill={fill}
            />
            {/* The facial disc: an owl's eyes read as huge because of the pale
                mask behind them, not because the pupils are big. */}
            <path d="M60 40c14 0 24 10 24 22s-11 20-24 20-24-8-24-20 10-22 24-22Z" fill="white" />
            <path d="M60 56 56 63h8Z" fill={deep} strokeWidth={2} />
            <Face mood={mood} y={60} />
            <path d="M46 100l-5 10M74 100l5 10" strokeWidth={2.5} />
            <path d="M34 70c-6 6-8 14-6 20M86 70c6 6 8 14 6 20" strokeWidth={2.5} opacity={0.55} />
          </>
        ) : null}

        {name === "atom" ? (
          <>
            {/* Three ellipses on one nucleus. Drawn at 60/120° rather than
                stacked, so it reads as orbits in perspective and not as a
                flower. */}
            <ellipse cx={60} cy={60} rx={48} ry={19} fill="none" strokeWidth={2.5} opacity={0.7} />
            <ellipse
              cx={60}
              cy={60}
              rx={48}
              ry={19}
              fill="none"
              strokeWidth={2.5}
              opacity={0.7}
              transform="rotate(60 60 60)"
            />
            <ellipse
              cx={60}
              cy={60}
              rx={48}
              ry={19}
              fill="none"
              strokeWidth={2.5}
              opacity={0.7}
              transform="rotate(-60 60 60)"
            />
            <circle cx={60} cy={60} r={22} fill={fill} />
            <Face mood={mood} y={60} />
            <circle cx={107} cy={54} r={4.5} fill={deep} />
            <circle cx={31} cy={95} r={4} fill={deep} />
          </>
        ) : null}

        {name === "pencil" ? (
          <>
            <path d="M40 30h40v56H40Z" fill={fill} />
            {/* Ferrule and rubber, so the top isn't a bare rectangle. */}
            <path
              d="M40 30h40V18a10 10 0 0 0-10-10H50a10 10 0 0 0-10 10Z"
              fill="color-mix(in oklab, var(--pop) 70%, white)"
            />
            <path d="M40 30h40" strokeWidth={3} />
            <path d="M40 86h40l-20 26Z" fill="white" />
            <path d="M52 103h16" strokeWidth={2.5} />
            <Face mood={mood} y={56} />
            <path d="M86 46c5-2 10-1 12 3M86 68c5 2 10 1 12-3" strokeWidth={2.5} opacity={0.5} />
          </>
        ) : null}
      </g>
    </svg>
  );
}

/* ── Accents ────────────────────────────────────────────────────────────────
   Non-character marks. These CAN appear on working screens — they are
   punctuation, not illustration. */

/** Hand-drawn underline, for the one phrase per page that carries the point. */
export function Squiggle({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 200 12"
      preserveAspectRatio="none"
      aria-hidden
      className={cn("h-2.5 w-full text-[color:var(--tint)]", className)}
      {...props}
    >
      <path
        d="M3 8c28-6 52 2 78-1s44-7 68 0 44 2 48 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Three-spark cluster. Sits next to a milestone number or a "new" flag. */
export function Sparkles({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("size-4 text-[color:var(--pop)]", className)}
      {...props}
    >
      <g fill="currentColor">
        <path d="M16 2l2.6 7.4L26 12l-7.4 2.6L16 22l-2.6-7.4L6 12l7.4-2.6Z" />
        <path d="M26 20l1.3 3.7L31 25l-3.7 1.3L26 30l-1.3-3.7L21 25l3.7-1.3Z" opacity={0.75} />
        <path d="M6 20l1 2.8L9.8 24 7 25l-1 2.8L5 25l-2.8-1L5 22.8Z" opacity={0.5} />
      </g>
    </svg>
  );
}

/**
 * A burst of confetti, absolutely positioned over its parent.
 *
 * Deterministic: the shards come from a fixed table rather than `Math.random`,
 * so the server and the client render the same thing and React doesn't warn
 * about a hydration mismatch on every milestone.
 */
const SHARDS = [
  { dx: "-64px", dy: "96px", dr: "260deg", left: "12%", delay: "0ms", c: "var(--pop)" },
  { dx: "-28px", dy: "120px", dr: "-190deg", left: "26%", delay: "60ms", c: "var(--bio)" },
  { dx: "10px", dy: "104px", dr: "300deg", left: "40%", delay: "20ms", c: "var(--primary)" },
  { dx: "38px", dy: "126px", dr: "-240deg", left: "54%", delay: "110ms", c: "var(--chem)" },
  { dx: "64px", dy: "92px", dr: "210deg", left: "68%", delay: "40ms", c: "var(--pop)" },
  { dx: "90px", dy: "118px", dr: "-280deg", left: "82%", delay: "90ms", c: "var(--phys)" },
] as const;

export function Confetti({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-0", className)}>
      {SHARDS.map((s, i) => (
        <span
          key={i}
          className="confetti-bit absolute top-0 block h-2.5 w-1.5 rounded-[2px]"
          style={
            {
              left: s.left,
              background: s.c,
              "--dx": s.dx,
              "--dy": s.dy,
              "--dr": s.dr,
              "--confetti-delay": s.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}
