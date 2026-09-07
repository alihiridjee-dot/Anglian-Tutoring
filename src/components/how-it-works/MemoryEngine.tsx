import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { applyReview, reviewEligibleAt, Rating, type Card, type Grade } from "@/lib/planner/scheduler";
import { mondayOnOrAfter } from "@/lib/planner/pacing";
import { ClipboardCheck, ListChecks } from "lucide-react";

/** Illustrative repeated outcomes using the real weekly eligibility rules.
 * A fixed epoch keeps server and client rendering deterministic. */

const DAY = 86_400_000;
const EPOCH = new Date("2025-01-06T00:00:00Z").getTime();
const HORIZON = 70; // days on the rail
const at = (d: number) => new Date(EPOCH + d * DAY);


/**
 * Walk the engine forward, always answering `rating`, and collect the due dates.
 *
 * Deliberately runs past {@link HORIZON}: the rail only draws the first ten
 * weeks, but a topic the student has nailed may have no second revisit inside
 * that window at all, and the fact that its next one is *months* away is the
 * strongest thing this section has to say. The caller filters for drawing; the
 * copy uses the whole walk.
 */
const STEPS = 8;

function schedule(rating: Grade): number[] {
  let card: Card | null = null;
  const days: number[] = [];
  let day = 0;
  for (let i = 0; i < STEPS; i++) {
    card = applyReview(card, rating, at(day));
    day = (mondayOnOrAfter(reviewEligibleAt(card)).getTime() - EPOCH) / DAY;
    days.push(day);
  }
  return days;
}

interface Lane {
  key: string;
  label: string;
  evidence: string;
  tone: "weak" | "steady" | "strong";
  days: number[];
}

const LANES: Lane[] = [
  {
    key: "weak",
    label: "Required practicals",
    evidence: "Quiz 40% · homework 5/12",
    tone: "weak",
    days: schedule(Rating.Again),
  },
  {
    key: "steady",
    label: "Transport in cells",
    evidence: "Quiz 70% · homework 9/12",
    tone: "steady",
    days: schedule(Rating.Good),
  },
  {
    key: "strong",
    label: "Cell structure",
    evidence: "Quiz 100% · homework 12/12",
    tone: "strong",
    days: schedule(Rating.Easy),
  },
];

const TONE: Record<Lane["tone"], { dot: string; bar: string; chip: string }> = {
  weak: {
    dot: "var(--destructive)",
    bar: "color-mix(in oklab, var(--destructive) 22%, transparent)",
    chip: "border-destructive/25 bg-destructive/5 text-destructive",
  },
  steady: {
    dot: "var(--warning)",
    bar: "color-mix(in oklab, var(--warning) 25%, transparent)",
    chip: "border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[oklch(0.45_0.12_70)]",
  },
  strong: {
    dot: "var(--accent)",
    bar: "color-mix(in oklab, var(--accent) 22%, transparent)",
    chip: "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--primary-deep)]",
  },
};

const SIGNALS = [
  { icon: ClipboardCheck, label: "Marked homework", note: "a real mark on real work" },
  { icon: ListChecks, label: "The weekly quiz", note: "recall, per spec point" },
];

/** Plain-English gap between the lesson and the first time it comes back. */
function firstReturn(lane: Lane): string {
  const d = lane.days[0];
  if (!d) return "—";
  return d === 1 ? "tomorrow" : `${Math.round(d)} days`;
}

/** The gap between the first revisit and the second — how fast it lets go. */
function secondGap(lane: Lane): number {
  const { days } = lane;
  return days.length < 2 ? 0 : Math.round(days[1] - days[0]);
}

export function MemoryEngine() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });

  return (
    <div ref={ref} className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
      {/* ---- What goes in ---- */}
      <div className="premium-card rounded-3xl p-6">
        <span className="eyebrow">Assessed practice, every week</span>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Graded practice helps estimate how likely your child is to recall each specification
          point. These two sources update its memory schedule.
        </p>

        <ul className="mt-5 space-y-3">
          {SIGNALS.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.li
                key={s.label}
                initial={{ opacity: 0, x: -10 }}
                animate={inView ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 0.1 + i * 0.09, duration: 0.45 }}
                className="flex items-start gap-3"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-[var(--accent-soft)]/60">
                  <Icon className="h-4 w-4 text-[var(--primary-deep)]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{s.label}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {s.note}
                  </span>
                </span>
              </motion.li>
            );
          })}
        </ul>

        <p className="mt-5 rounded-xl bg-secondary/70 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          Reviews follow marked work, with at least seven days between assessed practice and the
          next eligible review. Self-ratings do not change the memory schedule.
        </p>
      </div>

      {/* ---- What comes out ---- */}
      <div className="premium-card rounded-3xl p-6 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="eyebrow">What comes back, and when</span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            next 10 weeks
          </span>
        </div>

        <div className="mt-6 space-y-6">
          {LANES.map((lane, li) => (
            <div key={lane.key}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="font-display text-foreground text-sm leading-tight font-bold">
                    {lane.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{lane.evidence}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${TONE[lane.tone].chip}`}
                >
                  back in {firstReturn(lane)}
                </span>
              </div>

              {/* The rail. A dot is a revisit the scheduler booked by itself. */}
              <div className="relative h-9">
                <div className="absolute inset-x-0 top-4 h-1.5 rounded-full bg-secondary" />
                <motion.div
                  className="absolute left-0 top-4 h-1.5 rounded-full"
                  style={{ background: TONE[lane.tone].bar }}
                  initial={{ width: 0 }}
                  animate={inView ? { width: "100%" } : {}}
                  transition={{ delay: 0.2 + li * 0.15, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                />

                {/* The lesson itself, at day zero. */}
                <span className="absolute left-0 top-[9px] flex h-4 w-4 -translate-x-px items-center justify-center rounded-full border-[3px] border-[var(--primary-deep)] bg-white" />

                {lane.days
                  .filter((d) => d <= HORIZON)
                  .map((d, i) => (
                    <motion.span
                      key={d}
                      className="absolute top-[11px] h-3 w-3 rounded-full border-2 border-white"
                      style={{
                        left: `calc(${(d / HORIZON) * 100}% - 6px)`,
                        background: TONE[lane.tone].dot,
                      }}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={inView ? { scale: 1, opacity: 1 } : {}}
                      transition={{
                        delay: 0.35 + li * 0.15 + i * 0.07,
                        type: "spring",
                        stiffness: 320,
                        damping: 18,
                      }}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>

        {/* Shared axis, so the three rails are comparable at a glance. */}
        <div className="mt-1 flex justify-between border-t border-border pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          <span>Lesson</span>
          <span>3 weeks</span>
          <span>6 weeks</span>
          <span>10 weeks</span>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          These examples assume the same result at each review and show the earliest weekly slots.
          Actual results and the exam date determine the assigned dates.
          The shaky one is back in{" "}
          <strong className="font-semibold text-[var(--primary-deep)]">
            {firstReturn(LANES[0])}
          </strong>{" "}
          and keeps returning until it holds. The one they've nailed is left alone for{" "}
          <strong className="font-semibold text-[var(--primary-deep)]">
            {firstReturn(LANES[2])}
          </strong>
          , and then not again for another{" "}
          <strong className="font-semibold text-[var(--primary-deep)]">
            {secondGap(LANES[2])} days
          </strong>{" "}
          — but it does come back, just before it would have slipped. Nobody had to remember to book
          it.
        </p>
      </div>
    </div>
  );
}
