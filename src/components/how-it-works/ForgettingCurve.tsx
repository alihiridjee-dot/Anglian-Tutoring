import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from "motion/react";
import {
  applyReview,
  retrievability,
  reviewEligibleAt,
  scoreToRating,
  type Card,
} from "@/lib/planner/scheduler";
import { Squiggle } from "@/components/chat/EmptyInbox";

/**
 * The centrepiece of the "how it works" page: the forgetting curve, drawn by
 * the planner's own scheduler rather than by hand. Two lines over one GCSE term:
 *
 *   • "Revised once, never revisited" — the first quiz, then nothing.
 *   • "With our revisit schedule"     — the same quiz, and every revisit the
 *                                       planner books after it.
 *
 * The blue line plays the schedule for a child who does solidly on every quiz:
 * each quiz books the next revisit exactly as the planner would (FSRS's due
 * date, never sooner than a week, on a Monday), and the line draws on to it.
 *
 * Everything is worked out from a fixed epoch in UTC, so the server and the
 * client render the same curve wherever the visitor is.
 */

const HORIZON = 120; // days ≈ one GCSE term plus a bit
const DAY = 86_400_000;
const EPOCH = new Date("2025-01-06T00:00:00Z").getTime(); // a Monday
const at = (d: number) => new Date(EPOCH + d * DAY);

/** The four outcomes a parent recognises, mapped to the real score bands. */
const OUTCOMES = [
  {
    id: "struggled",
    label: "Struggled",
    band: "Under 50%",
    pct: 35,
    tint: "tint-rose",
    emoji: "😣",
  },
  { id: "shaky", label: "A bit shaky", band: "50–69%", pct: 60, tint: "tint-amber", emoji: "😬" },
  { id: "solid", label: "Solid", band: "70–89%", pct: 80, tint: "tint-primary", emoji: "🙂" },
  { id: "nailed", label: "Nailed it", band: "90%+", pct: 95, tint: "tint-emerald", emoji: "🤩" },
] as const;
type Outcome = (typeof OUTCOMES)[number];
const SOLID = OUTCOMES[2];

/** One quiz on the topic: the day it was sat, how it went, the memory after. */
interface Step {
  day: number;
  outcome: Outcome;
  card: Card;
}

/**
 * The day the planner brings the topic back: its earliest eligible date (the
 * FSRS due date, never sooner than a week), moved to the Monday on or after.
 * Every quiz here falls on a Monday, so that is whole weeks from the epoch.
 * The planner's `mondayOnOrAfter` does this in the visitor's own time zone,
 * which would draw a different curve in Sydney than on the server.
 */
function nextDay(card: Card) {
  const eligible = (reviewEligibleAt(card).getTime() - EPOCH) / DAY;
  return Math.ceil(eligible / 7 - 1e-9) * 7;
}

function answer(steps: Step[], outcome: Outcome): Step[] {
  const prev = steps[steps.length - 1];
  const day = prev ? nextDay(prev.card) : 0;
  const card = applyReview(prev?.card ?? null, scoreToRating(outcome.pct), at(day));
  return [...steps, { day, outcome, card }];
}

/** How far the line runs: to the next quiz, or the end of the term. */
const endOf = (steps: Step[]) => Math.min(nextDay(steps[steps.length - 1].card), HORIZON);
const finished = (steps: Step[]) => nextDay(steps[steps.length - 1].card) > HORIZON;

/** Recall on a day, from the memory left by the last quiz before it. */
const recall = (card: Card, d: number) => retrievability(card, at(d)) ?? 1;

/** Solid on every quiz: the schedule the blue line plays. */
const DEMO: Step[] = (() => {
  let s = answer([], SOLID);
  while (!finished(s)) s = answer(s, SOLID);
  return s;
})();

/** The control: the same first quiz, never revisited. */
const SOLO = DEMO[0].card;

// ---- geometry -------------------------------------------------------------
// The plot is drawn in a 100 × 100 box stretched to whatever size the page
// gives it, so the dots and labels laid over it in HTML sit at the same
// percentages and keep their own size on a phone. The height runs from nothing
// recalled to everything, with no axis to read.
const xOf = (d: number) => (d / HORIZON) * 100;
const yOf = (r: number) => (1 - r) * 100;
const pt = (d: number, r: number) => `${xOf(d).toFixed(2)},${yOf(r).toFixed(2)}`;

/** Each quiz lifts the line to the top; from there it fades to the next one. */
function lineOf(steps: Step[]) {
  const end = endOf(steps);
  let d = "";
  steps.forEach((s, i) => {
    const to = i + 1 < steps.length ? steps[i + 1].day : end;
    for (let day = s.day; day <= to; day++) {
      d += `${d ? "L" : "M"}${pt(day, recall(s.card, day))}`;
    }
  });
  return d;
}

/** The control's line: the same first quiz, never revisited. */
function soloLine(card: Card) {
  return Array.from(
    { length: HORIZON + 1 },
    (_, d) => `${d ? "L" : "M"}${pt(d, recall(card, d))}`,
  ).join("");
}
const BLUE_LINE = lineOf(DEMO);
const GREY_LINE = soloLine(SOLO);

// Floored rather than rounded: a topic last seen a week ago is not "100%".
const pct = (r: number) => Math.floor(r * 100);

const X_TICKS: { d: number; label: string }[] = [
  { d: 0, label: "Lesson" },
  { d: 30, label: "1 month" },
  { d: 60, label: "2 months" },
  { d: 90, label: "3 months" },
  { d: 120, label: "4 months" },
];

const DRAW_EASE = [0.22, 1, 0.36, 1] as const;

export function ForgettingCurve() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduce = useReducedMotion();
  // Whether the lines have finished drawing, so their end dots can land.
  const [drawn, setDrawn] = useState(false);

  // How far each line is drawn, in days.
  const grey = useMotionValue(0);
  const blue = useMotionValue(0);
  const greyClip = useTransform(grey, (d) => xOf(d) + 1);
  const blueClip = useTransform(blue, (d) => xOf(d) + 1);
  const [reached, setReached] = useState(0);
  useMotionValueEvent(blue, "change", (v) => setReached(Math.floor(v + 0.5)));

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      grey.set(HORIZON);
      blue.set(HORIZON);
      setDrawn(true);
      return;
    }
    const opts = { duration: 2.4, ease: DRAW_EASE, delay: 0.3 };
    const g = animate(grey, HORIZON, opts);
    const b = animate(blue, HORIZON, { ...opts, onComplete: () => setDrawn(true) });
    return () => {
      g.stop();
      b.stop();
    };
  }, [inView, reduce, grey, blue]);

  const last = DEMO[DEMO.length - 1];

  return (
    <div ref={ref} className="curve">
      <div
        className="curve-plot tint-primary"
        role="img"
        aria-label={`Over four months, a topic quizzed once and never revisited falls to about ${pct(recall(SOLO, HORIZON))} percent recall. On the planner's revisit schedule, the same topic is still at ${pct(recall(last.card, HORIZON))} percent.`}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="curve-svg" aria-hidden>
          <defs>
            <clipPath id="curve-clip-grey">
              <motion.rect x={-2} y={-10} height={120} width={greyClip} />
            </clipPath>
            <clipPath id="curve-clip-blue">
              <motion.rect x={-2} y={-10} height={120} width={blueClip} />
            </clipPath>
          </defs>
          <line x1={0} x2={100} y1={100} y2={100} className="curve-floor" />
          <path d={GREY_LINE} className="curve-line tint-slate" clipPath="url(#curve-clip-grey)" />
          <path d={BLUE_LINE} className="curve-line" clipPath="url(#curve-clip-blue)" />
        </svg>

        {/* Each quiz: how it went, where the line jumps back to the top. */}
        {DEMO.map((s) => (
          <span
            key={s.day}
            aria-hidden
            className={`curve-stop ${s.outcome.tint}`}
            data-on={reached >= s.day || undefined}
            style={{ left: `${xOf(s.day)}%`, top: `${yOf(1)}%` }}
          >
            {s.outcome.emoji}
          </span>
        ))}

        {drawn && (
          <>
            <span
              aria-hidden
              className="curve-end"
              style={{ left: `${xOf(HORIZON)}%`, top: `${yOf(recall(last.card, HORIZON))}%` }}
            />
            <span
              aria-hidden
              className="curve-end tint-slate"
              style={{ left: `${xOf(HORIZON)}%`, top: `${yOf(recall(SOLO, HORIZON))}%` }}
            />
          </>
        )}

        <div aria-hidden className="curve-ticks">
          {X_TICKS.map((k) => (
            <span
              key={k.d}
              style={{ left: `${xOf(k.d)}%` }}
              data-edge={k.d === 0 ? "start" : k.d === HORIZON ? "end" : undefined}
              data-minor={k.d % 60 === 30 || undefined}
            >
              {k.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The highlighter stroke under the section's title, drawn as it comes into view. */
export function CurveSquiggle() {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, amount: 1 });
  return (
    <span ref={ref} className="block h-5">
      {seen && <Squiggle />}
    </span>
  );
}
