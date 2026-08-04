import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { fsrs, generatorParameters, createEmptyCard, Rating, type Card } from "ts-fsrs";

/**
 * The centrepiece of the "how it works" page: the forgetting curve, drawn from
 * the *actual* scheduling engine the platform runs on rather than a hand-drawn
 * illustration. Two lines over one GCSE term:
 *
 *   • "Revised once, never revisited"  — one study session, left alone.
 *   • "With our revisit schedule"      — the same session, plus the handful of
 *                                        revisits the engine books automatically.
 *
 * Everything is computed once at module scope from a fixed epoch so the server
 * and the client render byte-identical SVG — this page is SSR'd, and a curve
 * built from `new Date()` would throw a hydration mismatch.
 */

const HORIZON = 120; // days ≈ one GCSE term plus a bit
const DAY = 86_400_000;
const EPOCH = new Date("2025-01-01T00:00:00Z").getTime();
const at = (d: number) => new Date(EPOCH + d * DAY);

// Long-term cadence: short-term (minutes-long) learning steps are switched off,
// because the product schedules revisits on a weekly rhythm, not as flashcards.
const engine = fsrs(
  generatorParameters({ enable_fuzz: false, enable_short_term: false, maximum_interval: 365 }),
);

function buildSeries() {
  // Walk the schedule the engine actually produces: study, then revisit exactly
  // when it says to, each time answering "solid".
  let card = createEmptyCard<Card>(at(0));
  let day = 0;
  const segments: { start: number; card: Card }[] = [];
  while (day <= HORIZON) {
    card = engine.next(card, at(day), Rating.Good).card;
    segments.push({ start: day, card });
    day = Math.round((card.due.getTime() - EPOCH) / DAY);
  }

  // The control: the same first session, never revisited.
  const solo = engine.next(createEmptyCard<Card>(at(0)), at(0), Rating.Good).card;

  const revisited: number[] = [];
  const neglected: number[] = [];
  for (let d = 0; d <= HORIZON; d++) {
    let seg = segments[0];
    for (const s of segments) if (s.start <= d) seg = s;
    revisited.push(engine.get_retrievability(seg.card, at(d), false) as number);
    neglected.push(engine.get_retrievability(solo, at(d), false) as number);
  }
  return { revisits: segments.map((s) => s.start), revisited, neglected };
}

const SERIES = buildSeries();

// ---- geometry -------------------------------------------------------------
const W = 860;
const H = 380;
const PAD = { l: 60, r: 30, t: 30, b: 56 };
const Y_MIN = 0.4; // zoom the band where the story happens

const px = (d: number) => PAD.l + (d / HORIZON) * (W - PAD.l - PAD.r);
const py = (r: number) =>
  PAD.t + (1 - (Math.max(r, Y_MIN) - Y_MIN) / (1 - Y_MIN)) * (H - PAD.t - PAD.b);

const toLine = (vals: number[]) =>
  vals.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");

const toArea = (vals: number[]) =>
  `${toLine(vals)} L${px(HORIZON).toFixed(1)},${py(Y_MIN)} L${px(0).toFixed(1)},${py(Y_MIN)} Z`;

const REVISITED_LINE = toLine(SERIES.revisited);
const REVISITED_AREA = toArea(SERIES.revisited);
const NEGLECTED_LINE = toLine(SERIES.neglected);

const END_REVISITED = Math.round(SERIES.revisited[HORIZON] * 100);
const END_NEGLECTED = Math.round(SERIES.neglected[HORIZON] * 100);

const Y_TICKS = [0.4, 0.6, 0.8, 1.0];
const X_TICKS: { d: number; label: string }[] = [
  { d: 0, label: "Lesson" },
  { d: 30, label: "1 month" },
  { d: 60, label: "2 months" },
  { d: 90, label: "3 months" },
  { d: 120, label: "4 months" },
];

const DRAW = { duration: 2.1, ease: [0.22, 1, 0.36, 1] as const };

export function ForgettingCurve() {
  /* Chrome's IntersectionObserver does not reliably track elements *inside* an
     <svg>, so per-element `whileInView` on the paths/dots never fires and the
     chart sits frozen at its initial state. Observe the figure (a real HTML
     box) once, and drive every child from that one flag instead. */
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const show = inView ? "shown" : "hidden";

  return (
    <figure
      ref={ref}
      className="relative rounded-3xl border border-border/80 bg-white/90 backdrop-blur-xl p-5 sm:p-8 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.45)]"
    >
      {/* Legend */}
      <figcaption className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-2 font-semibold text-[var(--primary-deep)]">
            <span className="h-2.5 w-5 rounded-full bg-primary" />
            With our revisit schedule
          </span>
          <span className="inline-flex items-center gap-2 font-semibold text-muted-foreground/70">
            <span className="h-2.5 w-5 rounded-full bg-border" />
            Revised once, never revisited
          </span>
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          How much they'd still recall
        </span>
      </figcaption>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          /* Scrolls inside its own container on narrow screens rather than
             squashing the axis labels below legibility. */
          className="w-full min-w-[460px]"
          role="img"
          aria-label={`Over four months, a topic revised once but never revisited decays to about ${END_NEGLECTED} percent recall, while the same topic on our automatic revisit schedule stays around ${END_REVISITED} percent.`}
        >
          <defs>
            <linearGradient id="fc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Horizontal grid + y labels */}
          {Y_TICKS.map((t) => (
            <g key={t}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={py(t)}
                y2={py(t)}
                stroke="currentColor"
                className="text-border"
                strokeWidth="1"
                strokeDasharray={t === 1 ? undefined : "3 6"}
              />
              <text
                x={PAD.l - 14}
                y={py(t) + 4}
                textAnchor="end"
                className="fill-[var(--muted-foreground)] text-[13px] font-medium tabular-nums"
              >
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}

          {/* X labels */}
          {X_TICKS.map((t) => (
            <text
              key={t.d}
              x={px(t.d)}
              y={H - PAD.b + 26}
              textAnchor={t.d === 0 ? "start" : t.d === HORIZON ? "end" : "middle"}
              className="fill-[var(--muted-foreground)] text-[13px] font-medium"
            >
              {t.label}
            </text>
          ))}

          {/* Revisit markers — the moments the schedule brings the topic back */}
          {SERIES.revisits.map((d, i) => (
            <motion.g
              key={d}
              initial="hidden"
              animate={show}
              variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
              transition={{ delay: 0.35 + (d / HORIZON) * DRAW.duration, duration: 0.4 }}
            >
              <line
                x1={px(d)}
                x2={px(d)}
                y1={py(SERIES.revisited[d])}
                y2={H - PAD.b}
                stroke="var(--primary)"
                strokeWidth="1.5"
                strokeDasharray="2 5"
                opacity="0.35"
              />
              {/* Only label the well-spaced later revisits — the first two sit
                  days apart and their labels would collide. */}
              {i > 0 && d >= 15 && (
                <text
                  x={px(d)}
                  y={H - PAD.b - 10}
                  textAnchor="middle"
                  className="fill-[var(--primary-deep)] text-[11px] font-bold"
                  opacity="0.65"
                >
                  revisit
                </text>
              )}
            </motion.g>
          ))}

          {/* Neglected curve */}
          <motion.path
            d={NEGLECTED_LINE}
            fill="none"
            stroke="currentColor"
            className="text-muted-foreground/50"
            strokeWidth="3.5"
            strokeLinecap="round"
            /* No strokeDasharray here — motion drives pathLength via
               stroke-dasharray, so a dashed style would be overwritten. */
            initial="hidden"
            animate={show}
            variants={{ hidden: { pathLength: 0 }, shown: { pathLength: 1 } }}
            transition={DRAW}
          />

          {/* Revisited curve + fill */}
          <motion.path
            d={REVISITED_AREA}
            fill="url(#fc-fill)"
            stroke="none"
            initial="hidden"
            animate={show}
            variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
            transition={{ delay: DRAW.duration * 0.55, duration: 0.9 }}
          />
          <motion.path
            d={REVISITED_LINE}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial="hidden"
            animate={show}
            variants={{ hidden: { pathLength: 0 }, shown: { pathLength: 1 } }}
            transition={DRAW}
          />

          {/* Dots on each revisit */}
          {SERIES.revisits.map((d) => (
            <motion.circle
              key={`dot-${d}`}
              cx={px(d)}
              cy={py(SERIES.revisited[d])}
              r="6"
              fill="white"
              stroke="var(--primary)"
              strokeWidth="3.5"
              initial="hidden"
              animate={show}
              variants={{
                hidden: { scale: 0, opacity: 0 },
                shown: { scale: 1, opacity: 1 },
              }}
              transition={{
                delay: 0.35 + (d / HORIZON) * DRAW.duration,
                type: "spring",
                stiffness: 300,
                damping: 18,
              }}
            />
          ))}

          {/* End-point callouts */}
          <motion.g
            initial="hidden"
            animate={show}
            variants={{
              hidden: { opacity: 0, x: -8 },
              shown: { opacity: 1, x: 0 },
            }}
            transition={{ delay: DRAW.duration + 0.15, duration: 0.5 }}
          >
            <text
              x={px(HORIZON) - 4}
              y={py(SERIES.revisited[HORIZON]) - 16}
              textAnchor="end"
              className="fill-[var(--primary-deep)] font-display text-[22px] font-bold tabular-nums"
            >
              {END_REVISITED}%
            </text>
            <text
              x={px(HORIZON) - 4}
              y={py(SERIES.neglected[HORIZON]) + 30}
              textAnchor="end"
              className="fill-[var(--muted-foreground)] font-display text-[22px] font-bold tabular-nums"
            >
              {END_NEGLECTED}%
            </text>
          </motion.g>
        </svg>
      </div>

      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
        Same lesson, same student — the only difference is whether anything brought the topic back.
        By exam term one has held{" "}
        <strong className="font-semibold text-[var(--primary-deep)]">
          {END_REVISITED}% of what they learned
        </strong>
        , the other roughly {END_NEGLECTED}%. And it took just {SERIES.revisits.length - 1} short
        revisits to get there.
      </p>
    </figure>
  );
}
