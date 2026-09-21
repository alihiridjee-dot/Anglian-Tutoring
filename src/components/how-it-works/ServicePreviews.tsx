import {
  Calendar,
  Check,
  Flag,
  MapPin,
  MessageSquarePlus,
  Paperclip,
  Sparkles,
  X,
} from "lucide-react";

/**
 * Small, faithful mock-ups of the six things a place actually buys.
 *
 * A parent reading "homework is marked and fed back" has to imagine what that
 * means. Showing them the card their child will actually open — the same
 * rounded corners, the same teal, the same grade chip — does the explaining
 * without a paragraph, and sets an accurate expectation of the product before
 * anyone pays for it.
 *
 * These are deliberately static and self-contained: no props, no data, no
 * imports from the live surfaces. A marketing page must not break because a
 * dashboard component changed its shape, and nothing here should ever be
 * mistaken for a real student's work — every name and mark below is invented.
 */

const shell =
  "rounded-2xl border border-border bg-card p-4 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)]";

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
    <div className={`${shell} p-5`} aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground/70">AQA GCSE Biology</p>
          <p className="font-display text-base font-bold text-foreground">
            Your programme to exam day
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600">
          <Check className="h-3 w-3" /> Built for you
        </span>
      </div>

      <div className="mt-7 flex gap-1">
        {bands.map((b, i) => (
          <div key={b.title} className="relative" style={{ flex: b.w }}>
            {i === 1 && (
              <MapPin className="absolute -top-5 left-1/2 h-4 w-4 -translate-x-1/2 text-primary" />
            )}
            <span
              className={`block h-3.5 rounded-[3px] ${
                i === 1 ? "ring-2 ring-primary/50 ring-offset-1 ring-offset-card" : ""
              }`}
              style={{ background: i <= 1 ? "#10b981" : "rgba(16, 185, 129, 0.22)" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-semibold text-muted-foreground">
        <span>Joined · Sep</span>
        <span className="inline-flex items-center gap-1">
          <Flag className="h-3 w-3" /> Exam · May
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-primary/15 bg-primary/[0.04] p-3">
        <p className="text-[11px] font-bold text-primary">This week</p>
        {[
          { tag: "Learn", text: "Organisation: enzymes and digestion", why: null },
          { tag: "Revisit", text: "Cell transport", why: "brought back by last week's quiz" },
        ].map((r) => (
          <div key={r.tag} className="flex items-start gap-2 text-xs">
            <span className="mt-px w-14 shrink-0 rounded-md bg-card py-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-muted-foreground ring-1 ring-border">
              {r.tag}
            </span>
            <span className="text-foreground">
              {r.text}
              {r.why && <span className="text-muted-foreground"> — {r.why}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3">
        {[
          { n: "92", l: "Spec points, all covered" },
          { n: "34", l: "Weeks, join to exam" },
          { n: "1", l: "Plan, just for your child" },
        ].map((stat) => (
          <div key={stat.l} className="text-center">
            <p className="font-display text-lg font-bold text-foreground">{stat.n}</p>
            <p className="text-[10px] leading-tight text-muted-foreground/70">{stat.l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The next-lesson card, as it sits at the top of the student's dashboard. */
export function LiveMock() {
  return (
    <div className={shell} aria-hidden>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] font-bold uppercase tracking-wider text-primary">
          Next live session
        </span>
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
          Biology
        </span>
        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
          GCSE
        </span>
      </div>
      <p className="mt-2 font-display text-sm font-bold leading-snug text-foreground">
        Exam technique for 6-mark questions
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Calendar className="h-3 w-3" /> Tuesday · 6:00pm · with Dr Nadia
      </p>
      <div className="mt-3 flex items-end gap-3">
        {[
          { v: "1", l: "day" },
          { v: "04", l: "hrs" },
          { v: "22", l: "min" },
        ].map((t) => (
          <div key={t.l}>
            <div className="font-display text-xl font-bold tabular-nums leading-none text-foreground">
              {t.v}
            </div>
            <div className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t.l}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A returned homework: the mark, and the sentence that says how to get the next one. */
export function HomeworkMock() {
  return (
    <div className={shell} aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-sm font-bold leading-snug text-foreground">
          Photosynthesis practical &amp; limiting factors
        </p>
        <span className="shrink-0 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--primary-deep)]">
          Marked
        </span>
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Paperclip className="h-3 w-3" /> pondweed_practical.pdf
      </p>

      <div className="mt-3 flex items-center gap-3 rounded-xl bg-secondary/70 px-3 py-2">
        <div>
          <div className="font-display text-lg font-bold leading-none text-[var(--primary-deep)]">
            8
          </div>
          <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            grade
          </div>
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <div className="font-display text-lg font-bold leading-none text-foreground">88%</div>
          <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            score
          </div>
        </div>
      </div>

      <p className="mt-3 border-l-2 border-primary/40 pl-3 text-[11px] leading-relaxed text-muted-foreground">
        “Excellent graph work. To push to a 9, say explicitly <em>why</em> the rate plateaus once
        CO₂ is saturated.”
      </p>
    </div>
  );
}

/** One quiz question, answered — the explanation is the point, not the tick. */
export function QuizMock() {
  return (
    <div className={shell} aria-hidden>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-wider text-primary">
          This week's quiz · Bioenergetics
        </span>
        <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">2 / 5</span>
      </div>
      <p className="mt-2 text-xs font-semibold leading-snug text-foreground">
        Which of these is <em>not</em> a limiting factor of photosynthesis?
      </p>

      <ul className="mt-2.5 space-y-1.5">
        {[
          { t: "Light intensity", state: "off" },
          { t: "CO₂ concentration", state: "wrong" },
          { t: "Soil colour", state: "right" },
        ].map((o) => (
          <li
            key={o.t}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
              o.state === "right"
                ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] font-semibold text-[var(--primary-deep)]"
                : o.state === "wrong"
                  ? "border-destructive/30 bg-destructive/5 text-muted-foreground line-through"
                  : "border-border text-muted-foreground"
            }`}
          >
            {o.state === "right" ? (
              <Check className="h-3 w-3 shrink-0 text-[var(--accent)]" />
            ) : o.state === "wrong" ? (
              <X className="h-3 w-3 shrink-0 text-destructive/70" />
            ) : (
              <span className="h-3 w-3 shrink-0 rounded-full border border-border" />
            )}
            {o.t}
          </li>
        ))}
      </ul>

      <p className="mt-2.5 rounded-lg bg-secondary/70 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
        <strong className="font-semibold text-foreground">Why:</strong> light, CO₂ and temperature
        limit the rate. Soil colour doesn't touch it.
      </p>
    </div>
  );
}

/** The weekly note — the bit that says a person looked at this child in particular. */
export function FeedbackMock() {
  return (
    <div className={shell} aria-hidden>
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--primary-deep)] to-primary text-[11px] font-bold text-white">
          N
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold leading-tight text-foreground">Dr Nadia</p>
          <p className="text-[10px] text-muted-foreground">Your tutor's note · this week</p>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        “Alex — osmosis has clicked, so I've moved it back in the schedule. Required practicals are
        still where the marks are leaking: you know the method, but the{" "}
        <strong className="font-semibold text-foreground">evaluation</strong> paragraph is thin.
        We'll do one together on Thursday.”
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {["4.1.3 Transport in cells", "Required practical 3"].map((t) => (
          <span
            key={t}
            className="rounded-md border border-border bg-secondary/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The message thread — a question pinned to the exact spec point it came from. */
export function ChatMock() {
  return (
    <div className={shell} aria-hidden>
      <div className="flex items-center gap-2 border-b border-border pb-2.5">
        <MessageSquarePlus className="h-3.5 w-3.5 text-primary" />
        <p className="text-xs font-bold text-foreground">Ask your tutor</p>
        <span className="ml-auto rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--primary-deep)]">
          4.4.1 Photosynthesis
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[11px] leading-relaxed text-primary-foreground">
            Why does the rate stop going up when I move the lamp closer?
          </p>
        </div>
        <div className="flex justify-start">
          <p className="max-w-[88%] rounded-2xl rounded-bl-md bg-secondary px-3 py-2 text-[11px] leading-relaxed text-foreground">
            Because light stopped being the limiting factor — something else took over. Look at your
            graph where it flattens: what else could be running short there?
          </p>
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-primary/60" /> Answered by your tutor, not a bot
      </p>
    </div>
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
    <div className={shell} aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-primary">
            Predicted grade · Biology
          </p>
          <p className="mt-1 font-display text-3xl font-bold leading-none text-foreground">7</p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600">
          Up from 5 in September
        </span>
      </div>

      <svg viewBox="0 0 200 66" className="mt-3 w-full" fill="none">
        <polygon points={`${x(0)},66 ${line} ${x(4)},66`} fill="rgba(16, 185, 129, 0.12)" />
        <polyline
          points={line}
          stroke="#10b981"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {grades.map((g, i) => (
          <circle key={i} cx={x(i)} cy={y(g)} r="3" fill="#10b981" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] font-semibold text-muted-foreground">
        <span>Sep</span>
        <span>Now</span>
      </div>

      <p className="mt-2.5 rounded-lg bg-secondary/70 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
        Worked out from <strong className="font-semibold text-foreground">6 marked homeworks</strong>{" "}
        and <strong className="font-semibold text-foreground">9 quizzes</strong>.
      </p>
    </div>
  );
}

/** The parent's view — the week at a glance, without having to ask their child. */
export function ParentMock() {
  return (
    <div className={shell} aria-hidden>
      <div className="flex items-center justify-between border-b border-border pb-2.5">
        <p className="text-xs font-bold text-foreground">Alex · this week</p>
        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
          Parent view
        </span>
      </div>
      <ul className="mt-1 divide-y divide-border">
        {[
          { l: "Lessons attended", v: "2 of 2" },
          { l: "Homework", v: "Marked · grade 8" },
          { l: "Weekly quiz", v: "4 / 5" },
          { l: "Predicted grade", v: "7" },
        ].map((r) => (
          <li key={r.l} className="flex items-center justify-between py-2 text-[11px]">
            <span className="text-muted-foreground">{r.l}</span>
            <span className="font-semibold tabular-nums text-foreground">{r.v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
