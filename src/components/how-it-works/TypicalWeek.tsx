import { motion } from "motion/react";
import { ClipboardCheck, ListChecks, MessageCircle, PenLine, Video } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One week, laid out — the answer to "so what actually happens?"
 *
 * The services list elsewhere on the page says what a place includes. This says
 * when each of them turns up, which is the thing a parent is really asking:
 * whether their child's week has a shape to it, or whether they've bought two
 * hours of Zoom and a folder of PDFs.
 *
 * Seven columns on a wide screen, a stacked list on a phone. The bar heights
 * are not data — they are a rhythm, so the eye reads the week as a shape
 * rather than a table.
 */

interface Day {
  day: string;
  full: string;
  icon: LucideIcon;
  what: string;
  detail: string;
  /** Visual weight, 1–4. Nothing is measured here; this is pacing. */
  weight: number;
  accent: "primary" | "accent" | "muted";
}

const WEEK: Day[] = [
  {
    day: "Mon",
    full: "Monday",
    icon: PenLine,
    what: "The week's plan",
    detail: "A short, specific list — the topics due back, chosen for them.",
    weight: 2,
    accent: "primary",
  },
  {
    day: "Tue",
    full: "Tuesday",
    icon: Video,
    what: "Live lesson",
    detail: "Small group on Zoom with Dr Nadia or Ali. Recorded.",
    weight: 4,
    accent: "primary",
  },
  {
    day: "Wed",
    full: "Wednesday",
    icon: ClipboardCheck,
    what: "Homework set",
    detail: "Answered in the platform, on the spec points just taught.",
    weight: 3,
    accent: "accent",
  },
  {
    day: "Thu",
    full: "Thursday",
    icon: Video,
    what: "Live lesson",
    detail: "Second session of the week, per subject.",
    weight: 4,
    accent: "primary",
  },
  {
    day: "Fri",
    full: "Friday",
    icon: ListChecks,
    what: "Weekly quiz",
    detail: "Tagged to the exact spec points, with instant explanations.",
    weight: 3,
    accent: "accent",
  },
  {
    day: "Sat",
    full: "Saturday",
    icon: ClipboardCheck,
    what: "Marked & returned",
    detail: "Their grade, and a sentence on how to get the next one.",
    weight: 3,
    accent: "accent",
  },
  {
    day: "Sun",
    full: "Sunday",
    icon: MessageCircle,
    what: "Anything stuck?",
    detail: "Message the tutor. The plan re-sorts for Monday.",
    weight: 2,
    accent: "muted",
  },
];

const BAR: Record<Day["accent"], string> = {
  primary: "bg-gradient-to-t from-[var(--primary-deep)] to-primary",
  accent: "bg-gradient-to-t from-[var(--accent)] to-[color-mix(in_oklab,var(--accent)_55%,white)]",
  muted: "bg-gradient-to-t from-muted-foreground/40 to-muted-foreground/20",
};

const ICON: Record<Day["accent"], string> = {
  primary: "text-[var(--primary-deep)] bg-[var(--accent-soft)]/60",
  accent: "text-[var(--primary-deep)] bg-[var(--accent-soft)]",
  muted: "text-muted-foreground bg-secondary",
};

export function TypicalWeek() {
  return (
    <div className="premium-card rounded-3xl p-5 sm:p-7">
      {/* Wide: seven columns with a bar each. */}
      <div className="hidden grid-cols-7 gap-3 md:grid">
        {WEEK.map((d, i) => {
          const Icon = d.icon;
          return (
            <motion.div
              key={d.day}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ delay: i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col"
            >
              <div className="flex h-28 items-end">
                <motion.div
                  className={`w-full rounded-t-xl ${BAR[d.accent]}`}
                  initial={{ height: 0 }}
                  whileInView={{ height: `${d.weight * 25}%` }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ delay: 0.15 + i * 0.07, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <div
                  className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg ${ICON[d.accent]}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {d.day}
                </p>
                <p className="mt-0.5 text-[13px] font-bold leading-tight text-foreground">
                  {d.what}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{d.detail}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Narrow: the same week as a list, because seven columns on a phone is unreadable. */}
      <ol className="space-y-3 md:hidden">
        {WEEK.map((d, i) => {
          const Icon = d.icon;
          return (
            <motion.li
              key={d.day}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className="flex gap-3"
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${ICON[d.accent]}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1 border-b border-border pb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {d.full}
                </p>
                <p className="text-sm font-bold leading-tight text-foreground">{d.what}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{d.detail}</p>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
