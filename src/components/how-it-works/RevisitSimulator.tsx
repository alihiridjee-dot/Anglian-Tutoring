import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { fsrs, generatorParameters, createEmptyCard, Rating, type Card } from "ts-fsrs";
import { RotateCcw, ArrowRight } from "lucide-react";
import { scoreToRating } from "@/lib/planner/scheduler";

/**
 * "Try it yourself" — a parent plays the part of their child sitting a weekly
 * quiz, and watches the schedule respond. This is not a mock-up: the outcomes
 * run through the platform's own `scoreToRating` thresholds and the same FSRS
 * engine that books real revisits, so what a parent sees here is what the
 * planner would actually do.
 */

const DAY = 86_400_000;
const EPOCH = new Date("2025-01-01T00:00:00Z").getTime();
const at = (d: number) => new Date(EPOCH + d * DAY);

const engine = fsrs(
  generatorParameters({ enable_fuzz: false, enable_short_term: false, maximum_interval: 365 }),
);

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

const TONES: Record<string, { chip: string; ring: string; text: string }> = {
  rose: {
    chip: "bg-rose-50 border-rose-200 hover:border-rose-400 text-rose-700",
    ring: "ring-rose-400",
    text: "text-rose-600",
  },
  amber: {
    chip: "bg-amber-50 border-amber-200 hover:border-amber-400 text-amber-700",
    ring: "ring-amber-400",
    text: "text-amber-600",
  },
  teal: {
    chip: "bg-primary/5 border-primary/25 hover:border-primary text-[var(--primary-deep)]",
    ring: "ring-primary",
    text: "text-[var(--primary-deep)]",
  },
  emerald: {
    chip: "bg-emerald-50 border-emerald-200 hover:border-emerald-400 text-emerald-700",
    ring: "ring-emerald-400",
    text: "text-emerald-600",
  },
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
    const next = engine.next(card ?? createEmptyCard<Card>(at(day)), at(day), grade).card;
    const gapDays = Math.max(1, Math.round((next.due.getTime() - EPOCH) / DAY - day));
    setSteps((prev) => [
      ...prev,
      { outcomeId: outcome.id, label: outcome.label, tone: outcome.tone, onDay: day, gapDays },
    ]);
    setCard(next);
    setDay(day + gapDays);
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
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-7 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.4)]">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          {steps.length === 0 ? "This week's quiz" : `Revisit ${steps.length}`}
        </span>
        <h3 className="mt-2 font-display text-xl font-bold text-slate-900">
          Osmosis in plant cells
        </h3>
        <p className="mt-1 text-xs font-medium text-slate-400">
          GCSE Biology · spec point B1.3 · AQA
        </p>

        <p className="mt-6 text-sm leading-relaxed text-slate-500">
          {steps.length === 0
            ? "Say your child has just sat the weekly quiz on this topic. How did it go?"
            : "They've come back to it. How did it go this time?"}
        </p>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {OUTCOMES.map((o) => {
            const tone = TONES[o.tone];
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => answer(o)}
                className={`group cursor-pointer rounded-2xl border px-4 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 ${tone.chip}`}
              >
                <span className="block text-sm font-bold">{o.label}</span>
                <span className="mt-0.5 block text-[11px] font-medium opacity-70 tabular-nums">
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
            className="mt-5 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-400 transition hover:text-slate-700"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Start again
          </button>
        )}
      </div>

      {/* ---- The response ---- */}
      <div className="relative flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--primary-deep)] to-primary p-6 sm:p-7 text-white shadow-[0_30px_70px_-30px_rgba(6,78,90,0.85)]">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-white/10 blur-3xl"
        />
        <span className="relative text-[11px] font-bold uppercase tracking-widest text-white/60">
          What the planner does
        </span>

        <div className="relative mt-4 flex-1">
          <AnimatePresence mode="wait">
            {!last ? (
              <motion.p
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-base leading-relaxed text-white/70"
              >
                Pick an outcome and watch the schedule respond. Nothing here is a guess — it's the
                same engine that plans your child's real week.
              </motion.p>
            ) : (
              <motion.div
                key={steps.length}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="text-sm font-medium text-white/70">We'll bring it back in</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span
                    className="font-display text-6xl font-bold leading-none tracking-tight tabular-nums"
                    style={{ fontFeatureSettings: '"tnum"' }}
                  >
                    {gap!.value}
                  </span>
                  <span className="font-display text-2xl font-semibold text-white/70">
                    {gap!.unit}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-white/80">{lastOutcome?.blurb}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Running history — the widening (or collapsing) gaps made visible */}
        {steps.length > 0 && (
          <div className="relative mt-6 border-t border-white/15 pt-5">
            <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">
              Their timeline so far
            </span>
            <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2">
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
                    <span className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap">
                      {s.label}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white/55 whitespace-nowrap">
                      <ArrowRight className="h-3 w-3" />
                      {g.value} {g.unit}
                    </span>
                  </motion.div>
                );
              })}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-white/60">
              Keep answering to see it play out. Strong weeks push the topic further away so it
              stops eating revision time; a weak week drags it straight back — even if they'd aced
              it before.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
