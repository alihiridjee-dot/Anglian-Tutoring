import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { type Card } from "ts-fsrs";
import { RotateCcw, ArrowRight } from "lucide-react";
import { applyReview, reviewEligibleAt, scoreToRating } from "@/lib/planner/scheduler";
import { mondayOnOrAfter } from "@/lib/planner/pacing";

/** One-point demonstration of assessed memory and earliest weekly eligibility.
 * Real assignments also depend on the exam horizon and saved assignments. */

const DAY = 86_400_000;
const EPOCH = new Date("2025-01-06T00:00:00Z").getTime();
const at = (d: number) => new Date(EPOCH + d * DAY);

/** The four outcomes a parent recognises, mapped to the real score bands. */
const OUTCOMES = [
  {
    id: "struggled",
    label: "Struggled",
    band: "Under 50%",
    pct: 35,
    tone: "rose",
    blurb: "We pull it right back to the front of the queue.",
  },
  {
    id: "shaky",
    label: "A bit shaky",
    band: "50–69%",
    pct: 60,
    tone: "amber",
    blurb: "Nearly there — it comes back around soon.",
  },
  {
    id: "solid",
    label: "Solid",
    band: "70–89%",
    pct: 80,
    tone: "teal",
    blurb: "Sticking. We leave it longer before the next look.",
  },
  {
    id: "nailed",
    label: "Nailed it",
    band: "90%+",
    pct: 95,
    tone: "emerald",
    blurb: "Banked. It won't waste their revision time again for a while.",
  },
] as const;

/** Each outcome's colour, from the kit's tints rather than Tailwind's palette. */
const TONES: Record<string, string> = {
  rose: "tint-rose",
  amber: "tint-amber",
  teal: "tint-primary",
  emerald: "tint-emerald",
};

interface Step {
  outcomeId: string;
  label: string;
  tone: string;
  /** Day the quiz was sat, on the simulated timeline. */
  onDay: number;
  /** Days until the schedule brings the topic back. */
  gapDays: number;
}

/** Humanise an interval the way a parent would say it. */
function humanGap(days: number): { value: string; unit: string } {
  if (days < 14)
    return { value: String(Math.max(1, Math.round(days))), unit: days < 2 ? "day" : "days" };
  if (days < 60) {
    const w = Math.round(days / 7);
    return { value: String(w), unit: w === 1 ? "week" : "weeks" };
  }
  const m = Math.round(days / 30);
  return { value: String(m), unit: m === 1 ? "month" : "months" };
}

export function RevisitSimulator() {
  const [card, setCard] = useState<Card | null>(null);
  const [day, setDay] = useState(0);
  const [steps, setSteps] = useState<Step[]>([]);

  const answer = (outcome: (typeof OUTCOMES)[number]) => {
    const grade = scoreToRating(outcome.pct);
    const next = applyReview(card, grade, at(day));
    const nextDay = (mondayOnOrAfter(reviewEligibleAt(next)).getTime() - EPOCH) / DAY;
    const gapDays = Math.round(nextDay - day);
    setSteps((prev) => [
      ...prev,
      { outcomeId: outcome.id, label: outcome.label, tone: outcome.tone, onDay: day, gapDays },
    ]);
    setCard(next);
    setDay(nextDay);
  };

  const reset = () => {
    setCard(null);
    setDay(0);
    setSteps([]);
  };

  const last = steps[steps.length - 1];
  const gap = last ? humanGap(last.gapDays) : null;
  const lastOutcome = last ? OUTCOMES.find((o) => o.id === last.outcomeId) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-8 items-stretch">
      {/* ---- The quiz ---- */}
      <div className="premium-card tint-primary p-5 sm:p-7">
        <p className="preview-kicker">
          {steps.length === 0 ? "This week's quiz" : `Revisit ${steps.length}`}
        </p>
        <h3 className="font-display text-foreground mt-1 text-2xl font-extrabold">
          Osmosis in plant cells
        </h3>
        <p className="preview-meta">GCSE Biology · spec point B1.3 · AQA</p>

        <p className="text-foreground mt-6 text-base leading-relaxed font-semibold">
          {steps.length === 0
            ? "Say your child has just sat the weekly quiz on this topic. How did it go?"
            : "They've come back to it. How did it go this time?"}
        </p>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {OUTCOMES.map((o) => {
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => answer(o)}
                className={`btn-soft ${TONES[o.tone]} cursor-pointer rounded-2xl px-4 py-3.5 text-left`}
              >
                <span className="block text-base font-extrabold">{o.label}</span>
                <span className="text-foreground mt-0.5 block text-sm font-semibold tabular-nums">
                  {o.band}
                </span>
              </button>
            );
          })}
        </div>

        {steps.length > 0 && (
          <button
            type="button"
            onClick={reset}
            className="text-muted-foreground hover:text-foreground mt-5 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold transition sm:pointer-fine:min-h-0"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Start again
          </button>
        )}
      </div>

      {/* ---- The response ---- */}
      <div className="tint-pop relative flex flex-col rounded-3xl bg-[var(--primary-deep)] p-5 text-white sm:p-7">
        <span aria-hidden className="preview-sticker" style={{ top: "1rem", right: "1rem" }}>
          🗓️
        </span>
        <p className="relative text-sm font-extrabold text-[var(--pop)]">What the planner does</p>

        <div className="relative mt-4 flex-1">
          <AnimatePresence mode="wait">
            {!last ? (
              <motion.p
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-base leading-relaxed font-semibold text-white"
              >
                Pick an outcome to see this point's earliest weekly review slot. Your child's actual
                assignment also depends on the exam date and any saved weekly plan.
              </motion.p>
            ) : (
              <motion.div
                key={steps.length}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="text-base font-semibold text-white">We'll bring it back in</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span
                    className="font-display text-6xl font-bold leading-none tracking-tight tabular-nums"
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {gap!.value}
                  </span>
                  <span className="font-display text-2xl font-extrabold">{gap!.unit}</span>
                </div>
                <p className="mt-4 text-base leading-relaxed font-semibold">{lastOutcome?.blurb}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Running history — the widening (or collapsing) gaps made visible */}
        {steps.length > 0 && (
          <div className="relative mt-7">
            <p className="text-sm font-extrabold text-[var(--pop)]">Their timeline so far</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {steps.map((s, i) => {
                const g = humanGap(s.gapDays);
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-center gap-1.5"
                  >
                    <span className="text-sm font-bold whitespace-nowrap">{s.label}</span>
                    <span className="inline-flex items-center gap-1 text-sm font-bold whitespace-nowrap text-[var(--pop)]">
                      <ArrowRight className="h-3 w-3" />
                      {g.value} {g.unit}
                    </span>
                  </motion.div>
                );
              })}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-white">
              Keep answering to see the earliest eligible weekly slots. Reviews wait at least seven
              days; the exam date and saved weekly plan can affect the actual assignment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
