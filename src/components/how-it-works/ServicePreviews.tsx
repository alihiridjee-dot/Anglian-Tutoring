import { useEffect, useState, type ReactNode } from "react";
import { Check, Paperclip, X } from "lucide-react";

/**
 * Small, faithful mock-ups of the things a place actually buys.
 *
 * A parent reading "homework is marked and fed back" has to imagine what that
 * means. Showing them the card their child will actually open does the
 * explaining without a paragraph, and sets an accurate expectation of the
 * product before anyone pays for it.
 *
 * Each is one card and nothing more: no pills, no capitals, no panel inside a
 * panel (9 Nov 2026, Ali's "boxes in boxes" clean-up). The card takes its
 * colour from the surrounding `--tint`, and an emoji is stuck on its corner.
 *
 * These are deliberately static and self-contained: no props, no data, no
 * imports from the live surfaces. A marketing page must not break because a
 * dashboard component changed its shape, and nothing here should ever be
 * mistaken for a real student's work. Every pupil, name and mark below is
 * invented; only the tutor is real.
 */

/** The card every preview is drawn on, with its emoji sticker. */
function Shot({ emoji, children }: { emoji: string; children: ReactNode }) {
  return (
    <div className="premium-card preview-shot" aria-hidden>
      <span className="preview-sticker">{emoji}</span>
      {children}
    </div>
  );
}

/**
 * The programme: the course laid out from the week they join to their exam
 * date (see `planner/pacing`), with this week's slice pulled out. The revisit
 * line comes from marked work, never self-rated confidence.
 */
export function ProgrammeMock() {
  // AQA GCSE Biology's seven topics, sized roughly by how much spec each holds.
  // The first is done, the second is this week, the rest are still ahead.
  const bands = [
    { title: "Cell biology", w: 15 },
    { title: "Organisation", w: 17 },
    { title: "Infection and response", w: 12 },
    { title: "Bioenergetics", w: 10 },
    { title: "Homeostasis and response", w: 16 },
    { title: "Inheritance, variation and evolution", w: 16 },
    { title: "Ecology", w: 14 },
  ];
  return (
    <Shot emoji="🗺️">
      <p className="preview-kicker">AQA GCSE Biology</p>
      <p className="preview-title">Your programme to exam day</p>

      <div className="mt-8 flex gap-1">
        {bands.map((b, i) => (
          <div key={b.title} className="relative" style={{ flex: b.w }}>
            {i === 1 && <span className="preview-pin">📍</span>}
            <span
              className={`preview-band ${i < 1 ? "is-done" : i === 1 ? "is-now" : "is-ahead"}`}
            />
          </div>
        ))}
      </div>
      <div className="preview-meta mt-2 flex justify-between">
        <span>Joined · Sep</span>
        <span>Exam · May 🏁</span>
      </div>

      <ul className="text-foreground mt-4 grid gap-2 text-sm font-semibold">
        <li>
          📖 <b className="preview-ink">Learn</b> Organisation: enzymes and digestion
        </li>
        <li>
          🔁 <b className="preview-ink">Revisit</b> Cell transport — brought back by last
          week&apos;s quiz
        </li>
      </ul>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          { n: "92", l: "Spec points, all covered" },
          { n: "34", l: "Weeks, join to exam" },
          { n: "1", l: "Plan, just for your child" },
        ].map((stat) => (
          <div key={stat.l}>
            <p className="numeral text-foreground text-[1.75rem]">{stat.n}</p>
            <p className="preview-meta leading-tight">{stat.l}</p>
          </div>
        ))}
      </div>
    </Shot>
  );
}

/** Counts a clock's seconds down, so the countdown is visibly live. */
function useSecondsLeft(start: number) {
  const [s, setS] = useState(start);
  useEffect(() => {
    const t = window.setInterval(() => setS((v) => (v + 59) % 60), 1000);
    return () => window.clearInterval(t);
  }, []);
  return String(s).padStart(2, "0");
}

/** The next-lesson card, as it sits at the top of the student's dashboard. */
export function LiveMock() {
  const seconds = useSecondsLeft(37);
  return (
    <Shot emoji="🎥">
      <p className="preview-kicker">Next live session</p>
      <p className="preview-title">Exam technique for 6-mark questions</p>
      <p className="preview-meta">GCSE Biology · Tuesday 6:00pm · with Dr Nadia</p>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        {[
          { v: "1", l: "day" },
          { v: "04", l: "hrs" },
          { v: "22", l: "min" },
          { v: seconds, l: "sec" },
        ].map((t, i) => (
          <span key={t.l} className="inline-flex items-baseline gap-1">
            <b className={`numeral text-[2rem] ${i === 3 ? "preview-ink" : "text-foreground"}`}>
              {t.v}
            </b>
            <span className="preview-meta">{t.l}</span>
          </span>
        ))}
      </div>
    </Shot>
  );
}

/** A returned homework: the mark, and the sentence that says how to get the next one. */
export function HomeworkMock() {
  return (
    <Shot emoji="✍️">
      <p className="preview-kicker">Marked ✓</p>
      <p className="preview-title">Photosynthesis practical &amp; limiting factors</p>
      <p className="preview-meta flex items-center gap-1.5">
        <Paperclip className="size-3.5" /> pondweed_practical.pdf
      </p>
      <div className="mt-3.5 flex items-center gap-4">
        <span className="preview-stamp numeral">8</span>
        <div>
          <p className="numeral text-foreground text-[1.875rem]">88%</p>
          <p className="preview-meta">Grade 8, scored 88%</p>
        </div>
      </div>
      <p className="text-foreground mt-3.5 text-sm leading-relaxed font-semibold">
        “Excellent graph work. To push to a 9, say explicitly why the rate plateaus once CO₂ is
        saturated.”
      </p>
    </Shot>
  );
}

/** One quiz question, answered — the explanation is the point, not the tick. */
export function QuizMock() {
  return (
    <Shot emoji="❓">
      <div className="flex items-baseline justify-between gap-3">
        <p className="preview-kicker">This week&apos;s quiz · Bioenergetics</p>
        <p className="preview-meta tabular-nums">2 / 5</p>
      </div>
      <p className="preview-title">Which of these is not a limiting factor of photosynthesis?</p>
      <ul className="mt-3 grid gap-2">
        <li className="preview-option">Light intensity</li>
        <li className="preview-option is-wrong">
          CO₂ concentration <X className="size-4 shrink-0" />
        </li>
        <li className="preview-option is-right">
          Soil colour <Check className="size-4 shrink-0" />
        </li>
      </ul>
      <p className="preview-meta mt-3">
        <b className="text-foreground">Why:</b> light, CO₂ and temperature limit the rate. Soil
        colour doesn&apos;t touch it.
      </p>
    </Shot>
  );
}

/** The weekly note — the bit that says a person looked at this child in particular. */
export function FeedbackMock() {
  return (
    <Shot emoji="💌">
      <div className="flex items-center gap-3">
        <span className="preview-avatar" style={{ backgroundImage: "url(/tutors/nadia.jpg)" }} />
        <div>
          <p className="preview-kicker">Dr Nadia</p>
          <p className="preview-meta">Your tutor&apos;s note · this week</p>
        </div>
      </div>
      <p className="text-foreground mt-3 text-sm leading-relaxed font-semibold">
        “Alex — osmosis has clicked, so I&apos;ve moved it back in the schedule. Required practicals
        are still where the marks are leaking: you know the method, but the{" "}
        <b className="preview-ink">evaluation</b> paragraph is thin. We&apos;ll do one together on
        Thursday.”
      </p>
      <p className="preview-meta mt-3">4.1.3 Transport in cells · Required practical 3</p>
    </Shot>
  );
}

/** The message thread — a question pinned to the exact spec point it came from. */
export function ChatMock() {
  return (
    <Shot emoji="💬">
      <p className="preview-kicker">Ask your tutor · 4.4.1 Photosynthesis</p>
      <p className="preview-bubble is-me">
        Why does the rate stop going up when I move the lamp closer?
      </p>
      <p className="preview-bubble is-them">
        Because light stopped being the limiting factor — something else took over. Look at your
        graph where it flattens: what else could be running short there?
      </p>
      <p className="preview-meta mt-3">Answered by your tutor, not a bot</p>
    </Shot>
  );
}

/** The predicted grade — a line that moves because marked work moved it. */
export function PredictorMock() {
  // Half-term grades, September to now. Plotted on a 4–9 scale.
  const grades = [5, 5, 6, 6, 7];
  const x = (i: number) => 8 + i * 46;
  const y = (g: number) => 58 - (g - 4) * 11;
  const line = grades.map((g, i) => `${x(i)},${y(g)}`).join(" ");
  return (
    <Shot emoji="📈">
      <p className="preview-kicker">Predicted grade · Biology</p>
      <div className="mt-1 flex items-center gap-4">
        <span className="numeral preview-ink text-[4.5rem]">7</span>
        <svg viewBox="0 0 200 66" className="preview-spark h-16 w-full" fill="none">
          <polyline points={line} />
          <circle cx={x(4)} cy={y(7)} r="5" />
        </svg>
      </div>
      <p className="preview-meta mt-2">
        Up from 5 in September · worked out from 6 marked tasks and 9 quizzes
      </p>
    </Shot>
  );
}

/** The parent's view — the week at a glance, without having to ask their child. */
export function ParentMock() {
  return (
    <Shot emoji="👪">
      <p className="preview-kicker">Parent view</p>
      <p className="preview-title">Alex · this week</p>
      <ul className="mt-3 grid gap-2.5">
        {[
          { l: "Lessons attended", v: "2 of 2" },
          { l: "Tasks", v: "Marked · grade 8" },
          { l: "Weekly quiz", v: "4 / 5" },
          { l: "Predicted grade", v: "7" },
        ].map((r) => (
          <li
            key={r.l}
            className="text-foreground flex items-baseline justify-between gap-3 text-sm font-semibold"
          >
            <span>{r.l}</span>
            <b className="numeral preview-ink text-[1.0625rem] tabular-nums">{r.v}</b>
          </li>
        ))}
      </ul>
    </Shot>
  );
}
