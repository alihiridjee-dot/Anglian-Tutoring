import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
} from "motion/react";
import { RotateCcw } from "lucide-react";
import {
  applyReview,
  retrievability,
  reviewEligibleAt,
  scoreToRating,
  type Card,
} from "@/lib/planner/scheduler";
import { Ring } from "@/components/Shared";
import { Squiggle } from "@/components/chat/EmptyInbox";
import { Tally } from "@/components/planner/workbench/figures";

/**
 * The centrepiece of the "how it works" page: the forgetting curve, drawn by
 * the planner's own scheduler rather than by hand, with the visitor playing
 * their child. Two lines over one GCSE term:
 *
 *   • "Revised once, never revisited" — the first quiz, then nothing.
 *   • "With our revisit schedule"     — the same quiz, and every revisit the
 *                                       planner books after it.
 *
 * On arrival the blue line plays the schedule for a child who does solidly on
 * every quiz. Answering a quiz below takes over: the line starts again from the
 * lesson, and each answer books the next revisit exactly as the planner would
 * (FSRS's due date, never sooner than a week, on a Monday), and draws on to it.
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
    blurb: "We pull it right back to the front of the queue.",
  },
  {
    id: "shaky",
    label: "A bit shaky",
    band: "50–69%",
    pct: 60,
    tint: "tint-amber",
    emoji: "😬",
    blurb: "Nearly there — it comes back around soon.",
  },
  {
    id: "solid",
    label: "Solid",
    band: "70–89%",
    pct: 80,
    tint: "tint-primary",
    emoji: "🙂",
    blurb: "Sticking. We leave it longer before the next look.",
  },
  {
    id: "nailed",
    label: "Nailed it",
    band: "90%+",
    pct: 95,
    tint: "tint-emerald",
    emoji: "🤩",
    blurb: "Banked. It won't waste their revision time again for a while.",
  },
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

/** Solid on every quiz: what the line shows before the visitor takes over. */
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
// recalled to everything, with no axis to read: the rings below say the figure.
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
/** One per way the first quiz can go, so the control always starts where the child did. */
const SOLO_LINES = Object.fromEntries(
  OUTCOMES.map((o) => [o.id, soloLine(answer([], o)[0].card)]),
) as Record<Outcome["id"], string>;

// Floored rather than rounded: a topic last seen a week ago is not "100%".
const pct = (r: number) => Math.floor(r * 100);

const X_TICKS: { d: number; label: string }[] = [
  { d: 0, label: "Lesson" },
  { d: 30, label: "1 month" },
  { d: 60, label: "2 months" },
  { d: 90, label: "3 months" },
  { d: 120, label: "4 months" },
];

/** A gap the way a parent would say it. */
function inWords(days: number) {
  if (days === 7) return "a week";
  if (days < 56) return `${Math.round(days / 7)} weeks`;
  const m = Math.round(days / 30);
  return m === 1 ? "a month" : `${m} months`;
}

const DRAW_EASE = [0.22, 1, 0.36, 1] as const;

export function ForgettingCurve() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const reduce = useReducedMotion();

  // The quizzes on the line, and whether they are the visitor's own answers.
  const [steps, setSteps] = useState<Step[]>(DEMO);
  const [mine, setMine] = useState(false);
  // What the rings, the heading and the next quiz show. It catches up with
  // `steps` once the line has finished drawing to the new end.
  const [shown, setShown] = useState<Step[] | null>(null);

  // How far each line is drawn, in days.
  const grey = useMotionValue(0);
  const blue = useMotionValue(0);
  const greyClip = useTransform(grey, (d) => xOf(d) + 1);
  const blueClip = useTransform(blue, (d) => xOf(d) + 1);
  const [reached, setReached] = useState(0);
  useMotionValueEvent(blue, "change", (v) => setReached(Math.floor(v + 0.5)));
  const drawing = useRef<AnimationPlaybackControls | null>(null);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      grey.set(HORIZON);
      blue.set(HORIZON);
      setShown(DEMO);
      return;
    }
    const opts = { duration: 2.4, ease: DRAW_EASE, delay: 0.3 };
    const g = animate(grey, HORIZON, opts);
    drawing.current = animate(blue, HORIZON, { ...opts, onComplete: () => setShown(DEMO) });
    return () => {
      g.stop();
      drawing.current?.stop();
    };
  }, [inView, reduce, grey, blue]);

  /** Draw the blue line on from `from` to the new end, then settle on it. */
  const drawTo = (next: Step[], from: number) => {
    drawing.current?.stop();
    const to = endOf(next);
    if (reduce) {
      grey.set(HORIZON);
      blue.set(to);
      setShown(next);
      return;
    }
    // A new first quiz is a new control too: its line draws again beside it.
    if (from === 0) {
      grey.set(0);
      animate(grey, HORIZON, { duration: 1.8, ease: DRAW_EASE });
    } else {
      grey.set(HORIZON);
    }
    blue.set(from);
    drawing.current = animate(blue, to, {
      duration: 0.5 + ((to - from) / HORIZON) * 1.8,
      ease: [0.33, 1, 0.68, 1],
      onComplete: () => setShown(next),
    });
  };

  const pick = (o: Outcome) => {
    // The first answer wipes the demo and starts the line from the lesson.
    const base = mine ? steps : [];
    if (base.length && finished(base)) return;
    const next = answer(base, o);
    setSteps(next);
    setMine(true);
    drawTo(next, base.length ? endOf(base) : 0);
  };

  const restart = () => {
    drawing.current?.stop();
    setSteps(DEMO);
    setMine(false);
    grey.set(HORIZON);
    blue.set(HORIZON);
    setShown(DEMO);
  };

  const settled = shown === steps;
  const last = steps[steps.length - 1];
  const done = finished(steps);
  const waitingOn = mine && settled && !done ? endOf(steps) : null;

  // The rings: how much each would recall on the day the line has reached.
  const end = shown ? endOf(shown) : HORIZON;
  const lastShown = shown?.[shown.length - 1];
  const blueNow = lastShown ? pct(recall(lastShown.card, end)) : 0;
  const soloNow = shown?.[0].card ?? SOLO;
  const greyNow = pct(recall(soloNow, end));
  const revisits = shown ? shown.length - 1 : 0;

  return (
    <div ref={ref} className="curve">
      <div
        className="curve-plot tint-primary"
        role="img"
        aria-label={`Over four months, a topic quizzed once and never revisited falls to about ${pct(recall(SOLO, HORIZON))} percent recall. On the planner's revisit schedule, the same topic is still at ${pct(recall(DEMO[DEMO.length - 1].card, HORIZON))} percent.`}
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
          <path
            d={SOLO_LINES[steps[0].outcome.id]}
            className="curve-line tint-slate"
            clipPath="url(#curve-clip-grey)"
          />
          <path d={lineOf(steps)} className="curve-line" clipPath="url(#curve-clip-blue)" />
        </svg>

        {/* Each quiz: how it went, where the line jumps back to the top. */}
        {steps.map((s) => (
          <span
            key={`${mine}-${s.day}`}
            aria-hidden
            className={`curve-stop ${s.outcome.tint}`}
            data-on={reached >= s.day || undefined}
            style={{ left: `${xOf(s.day)}%`, top: `${yOf(1)}%` }}
          >
            {s.outcome.emoji}
          </span>
        ))}

        {/* The next quiz the planner has booked, waiting to be answered. */}
        {waitingOn !== null && (
          <span
            key={waitingOn}
            aria-hidden
            className="curve-stop curve-next"
            data-on
            style={{ left: `${xOf(waitingOn)}%`, top: `${yOf(recall(last.card, waitingOn))}%` }}
          >
            <span className="curve-pencil">✏️</span>
          </span>
        )}

        {shown && (
          <>
            {(!mine || done) && settled && (
              <span
                aria-hidden
                className="curve-end"
                style={{ left: `${xOf(end)}%`, top: `${yOf(recall(last.card, end))}%` }}
              />
            )}
            <span
              aria-hidden
              className="curve-end tint-slate"
              style={{ left: `${xOf(end)}%`, top: `${yOf(recall(soloNow, end))}%` }}
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

      <div className="curve-below">
        {/* ---- Try the scheduler ---- */}
        <div className="curve-play">
          <h3 className="curve-h">Try the scheduler</h3>
          <p className="curve-ask">
            {!mine
              ? "Say your child has just sat the weekly quiz on osmosis in plant cells. How did it go?"
              : done
                ? "That's the term."
                : "They've come back to it. How did it go this time?"}
          </p>

          {!done || !mine ? (
            <div
              role="group"
              aria-label="How the quiz went"
              className="point-trail curve-trail tint-primary"
              style={{ "--stops": OUTCOMES.length } as CSSProperties}
            >
              <svg
                aria-hidden
                className="point-trail-path"
                viewBox="0 0 300 40"
                preserveAspectRatio="none"
              >
                <path
                  d="M0 20 C30 4 70 36 100 20 C130 36 170 4 200 20 C230 4 270 36 300 20"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {OUTCOMES.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => pick(o)}
                  aria-pressed={mine && last.outcome.id === o.id}
                  className={`point-stop ${o.tint}`}
                >
                  <span aria-hidden className="point-stop-dot">
                    {o.emoji}
                  </span>
                  <span className="point-stop-label">{o.label}</span>
                  <span className="point-stop-word">{o.band}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div aria-live="polite">
            {mine && (
              <div key={steps.length} className={`curve-reply point-panel ${last.outcome.tint}`}>
                <p className="curve-booked">
                  We'll bring it back in{" "}
                  <span className="marker">{inWords(nextDay(last.card) - last.day)}</span>
                </p>
                <p className="curve-blurb">{last.outcome.blurb}</p>
              </div>
            )}
          </div>

          {mine && (
            <button
              type="button"
              onClick={restart}
              className="paywall-link tint-primary mt-3 -ml-3"
            >
              <RotateCcw className="size-4" /> Start again
            </button>
          )}
        </div>

        {/* ---- What they'd remember ---- */}
        <div className="curve-rings">
          <h3 className="curve-h">
            How much they&apos;d still recall {mine ? whenWords(end) : "after 4 months"}
          </h3>
          <Result
            tint="tint-primary"
            value={blueNow}
            show={!!shown}
            name="With our revisit schedule"
            tally={
              <Tally n={revisits} word={revisits === 1 ? "short revisit" : "short revisits"} />
            }
          />
          <Result
            tint="tint-slate"
            value={greyNow}
            show={!!shown}
            name="Revised once, never revisited"
            tally={<Tally n={0} word="revisits" />}
          />
        </div>
      </div>

      <p className="curve-close">
        Same lesson, same student — the only difference is whether anything brought the topic back.
      </p>
    </div>
  );
}

/** "after 3 weeks", for the heading over the rings. */
function whenWords(d: number) {
  return d >= HORIZON ? "after 4 months" : `after ${inWords(d)}`;
}

/** One student's result: the ring, filled as far as they'd recall, and whose it is. */
function Result({
  tint,
  value,
  show,
  name,
  tally,
}: {
  tint: string;
  value: number;
  show: boolean;
  name: string;
  tally: React.ReactNode;
}) {
  const n = useCountUp(value, show);
  return (
    <div className={`curve-result ${tint}`}>
      <Ring value={show ? value : 0} size={80} stroke={10}>
        <span className="numeral text-2xl">{show ? n : "…"}%</span>
      </Ring>
      <div>
        <p className="curve-name">{name}</p>
        <p className="curve-tally">{tally}</p>
      </div>
    </div>
  );
}

/** A figure that runs from where it was to its new value, alongside the ring. */
function useCountUp(to: number, run: boolean) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (!run) return;
    const c = animate(from.current, to, {
      duration: 1,
      ease: DRAW_EASE,
      onUpdate: (v) => {
        from.current = v;
        setN(Math.round(v));
      },
    });
    return () => c.stop();
  }, [to, run]);
  return n;
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
