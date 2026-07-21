import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Pricing model
//
// A plan is built from three choices — level (KS3/GCSE), how many subjects, and
// cadence — plus a board that is captured but never affects price. KS3 and GCSE
// cost the same. Combined-Science Trilogy is a GCSE-only qualification that
// always counts as three subjects.
//
// Monthly is the anchor the business sets directly. Weekly and Termly are
// derived from it with the ratios baked into the original 1-subject prices
// (weekly ≈ monthly × 0.4, termly ≈ monthly × 2.8), rounded to a clean .99.
// Numbers are stored in pence to avoid float drift.
//
// Live sessions scale at 2 per subject per week, so per-session equivalence
// falls as students add subjects — that lower number is the headline value.
// ---------------------------------------------------------------------------

type Count = 1 | 2 | 3;
type Cadence = "weekly" | "monthly" | "termly";

const PRICE_PENCE: Record<Cadence, Record<Count, number>> = {
  weekly: { 1: 1999, 2: 2239, 3: 2399 },
  monthly: { 1: 4999, 2: 5599, 3: 5999 },
  termly: { 1: 13999, 2: 15699, 3: 16799 },
};

const SESSIONS: Record<Cadence, (n: Count) => number> = {
  weekly: (n) => 2 * n,
  monthly: (n) => 8 * n,
  termly: (n) => 24 * n,
};

const CADENCES: {
  cadence: Cadence;
  name: string;
  billing: string;
  badge: string;
  highlight: boolean;
}[] = [
  { cadence: "weekly", name: "Weekly", billing: "per week", badge: "Flexible", highlight: false },
  {
    cadence: "monthly",
    name: "Monthly Saver",
    billing: "per month",
    badge: "Trackable",
    highlight: true,
  },
  { cadence: "termly", name: "Termly", billing: "per term", badge: "Stable", highlight: false },
];

const SUBJECTS = [
  { id: "biology", label: "Biology", comingSoon: false },
  { id: "chemistry", label: "Chemistry", comingSoon: false },
  { id: "physics", label: "Physics", comingSoon: true },
  { id: "maths", label: "Maths", comingSoon: true },
] as const;

const BOARDS = [
  { id: "aqa", label: "AQA" },
  { id: "edexcel", label: "Edexcel" },
  { id: "ocr", label: "OCR" },
] as const;

const gbp = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PricingSection() {
  const [level, setLevel] = useState<"ks3" | "gcse">("gcse");
  const [trilogy, setTrilogy] = useState(false);
  const [subjects, setSubjects] = useState<string[]>(["biology"]);
  const [board, setBoard] = useState<string>("aqa");
  const [openStep, setOpenStep] = useState<0 | 1 | 2>(0);

  const isTrilogy = level === "gcse" && trilogy;
  const count = (isTrilogy ? 3 : Math.max(1, subjects.length)) as Count;

  const toggleSubject = (id: string) => {
    setTrilogy(false);
    setSubjects((prev) =>
      prev.includes(id)
        ? prev.length === 1
          ? prev
          : prev.filter((s) => s !== id)
        : [...prev, id],
    );
  };

  const chosenSubjects = isTrilogy ? ["biology", "chemistry", "physics"] : subjects;
  const level_key = level === "ks3" ? "ks3" : isTrilogy ? "gcse_trilogy" : "gcse_separate";

  const subjectsSummary = isTrilogy
    ? "Combined Trilogy"
    : SUBJECTS.filter((s) => subjects.includes(s.id))
        .map((s) => s.label)
        .join(", ");

  return (
    <section id="pricing" className="relative py-24 lg:py-28 overflow-hidden bg-slate-50">
      {/* Ambient premium backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--accent-soft)_0%,transparent_55%)] opacity-60"
      />
      <div className="relative max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 backdrop-blur px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--primary-deep)]">
            <Sparkles className="w-3.5 h-3.5" /> Build your plan
          </span>
          <h2 className="mt-5 font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
            A plan that fits your child
          </h2>
          <p className="mt-4 text-base text-slate-500 leading-relaxed">
            Choose what suits them and watch the price update as you go. Cancel anytime.
          </p>
        </div>

        {/* ---- Banner: builder and live pricing side by side ---- */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-10 items-stretch">
          {/* Plan builder: a guided, collapsing three-step card */}
          <div className="rounded-3xl border border-slate-200/80 bg-white/80 backdrop-blur-xl shadow-[0_20px_60px_-25px_rgba(15,23,42,0.35)] divide-y divide-slate-100 overflow-hidden lg:sticky lg:top-24">
            <Step
              index={1}
              title="What level?"
              summary={level === "ks3" ? "KS3 (Years 7–9)" : isTrilogy ? "GCSE · Trilogy" : "GCSE"}
              open={openStep === 0}
              onOpen={() => setOpenStep(0)}
            >
              <Slider
                options={[
                  { value: "ks3", label: "KS3" },
                  { value: "gcse", label: "GCSE" },
                ]}
                value={level}
                onChange={(v) => {
                  const next = v as "ks3" | "gcse";
                  setLevel(next);
                  if (next === "ks3") {
                    setTrilogy(false);
                    // Let the toggle finish its slide before the step collapses.
                    window.setTimeout(() => setOpenStep(1), 340);
                  }
                }}
              />
              {level === "gcse" && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    How they study
                  </p>
                  <Slider
                    options={[
                      { value: "separate", label: "Separate Sciences" },
                      { value: "trilogy", label: "Combined Trilogy" },
                    ]}
                    value={trilogy ? "trilogy" : "separate"}
                    onChange={(v) => setTrilogy(v === "trilogy")}
                  />
                  <button
                    type="button"
                    onClick={() => window.setTimeout(() => setOpenStep(1), 40)}
                    className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                  >
                    Continue
                  </button>
                </div>
              )}
            </Step>

            <Step
              index={2}
              title="Which subjects?"
              summary={subjectsSummary}
              open={openStep === 1}
              onOpen={() => setOpenStep(1)}
            >
              <div className="grid grid-cols-2 gap-2.5">
                {SUBJECTS.map((s) => {
                  const soon = s.comingSoon;
                  const on = !soon && (isTrilogy || subjects.includes(s.id));
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={isTrilogy || soon}
                      onClick={() => toggleSubject(s.id)}
                      className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-2xl border px-3 py-4 text-sm font-semibold transition-all duration-200 ${
                        soon
                          ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                          : on
                            ? "border-primary bg-primary/[0.06] text-[var(--primary-deep)] shadow-sm cursor-pointer"
                            : "border-slate-200 bg-white text-slate-600 hover:border-primary/40 hover:-translate-y-0.5 cursor-pointer"
                      } ${isTrilogy && !soon ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {soon && (
                        <span className="absolute right-2 top-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                          Soon
                        </span>
                      )}
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                          on ? "border-primary bg-primary text-white" : "border-slate-300 text-transparent"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                {isTrilogy
                  ? "Combined Trilogy covers all three sciences in one course."
                  : "Choose one or more — price adjusts automatically."}
              </p>
              <p className="mt-1.5 text-xs font-medium text-[var(--primary-deep)]/70">
                Physics &amp; Maths coming soon — we're building out our team of specialists!
              </p>
              <button
                type="button"
                onClick={() => setOpenStep(2)}
                className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
              >
                Continue
              </button>
            </Step>

            <Step
              index={3}
              title="Exam board"
              summary={BOARDS.find((b) => b.id === board)?.label ?? ""}
              open={openStep === 2}
              onOpen={() => setOpenStep(2)}
              last
            >
              <Slider
                options={BOARDS.map((b) => ({ value: b.id, label: b.label }))}
                value={board}
                onChange={setBoard}
              />
              <p className="mt-3 text-xs text-slate-400">The board never changes your price.</p>
            </Step>
          </div>

          {/* Live pricing tiers — all three shown at once, each a full-height
              premium card that matches the builder's height (items-stretch) */}
          <PricingTiers
            count={count}
            level_key={level_key}
            chosenSubjects={chosenSubjects}
            board={board}
          />
        </div>
      </div>
    </section>
  );
}

/** Live pricing tiers — all three shown side by side, each a full-height
 *  premium card. The wrapper is h-full so the row (items-stretch on the outer
 *  grid) makes every card match the builder's height exactly. The middle
 *  "Best value" tier is lifted and styled dark to draw the eye. */
function PricingTiers({
  count,
  level_key,
  chosenSubjects,
  board,
}: {
  count: Count;
  level_key: string;
  chosenSubjects: string[];
  board: string;
}) {
  return (
    <div className="grid h-full grid-cols-3 gap-3 sm:gap-4">
      {CADENCES.map((tier) => {
        const pence = PRICE_PENCE[tier.cadence][count];
        const perSession = pence / SESSIONS[tier.cadence](count);
        const weeklyLessons = 2 * count;
        const dark = tier.highlight;

        return (
          <div
            key={tier.cadence}
            className={`relative flex h-full flex-col overflow-hidden rounded-3xl p-5 transition-transform duration-300 ${
              dark
                ? "bg-gradient-to-br from-[var(--primary-deep)] to-primary text-white shadow-[0_30px_70px_-30px_rgba(6,78,90,0.85)] ring-2 ring-[var(--primary-deep)]/20"
                : "bg-white text-slate-900 border border-slate-200/70 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.4)] hover:-translate-y-1"
            }`}
          >
            {/* Soft premium sheen */}
            <div
              aria-hidden
              className={`pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full blur-3xl ${
                dark ? "bg-white/10" : "bg-[var(--accent-soft)]/60"
              }`}
            />

            {/* Identity */}
            <div className="relative">
              <span
                className={`inline-block rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${
                  dark ? "bg-white/15 text-white" : "bg-[var(--accent-soft)] text-[var(--primary-deep)]"
                }`}
              >
                {tier.badge}
              </span>
              <h3 className="mt-2.5 font-display text-lg font-bold leading-tight">{tier.name}</h3>
            </div>

            {/* Premium price button — headline per-session cost in a lifted pill */}
            <div
              className={`relative mt-4 rounded-2xl px-4 py-3.5 ${
                dark
                  ? "bg-white/10 ring-1 ring-inset ring-white/20"
                  : "bg-[var(--accent-soft)]/70 ring-1 ring-inset ring-[var(--primary-deep)]/10"
              }`}
            >
              <div className="flex items-baseline gap-1">
                <span
                  className={`font-display text-3xl font-semibold leading-none tracking-tight tabular-nums ${
                    dark ? "text-white" : "text-[var(--primary-deep)]"
                  }`}
                  style={{ fontFeatureSettings: '"ss01","tnum"' }}
                >
                  {gbp(Math.round(perSession)).replace(".00", "")}
                </span>
              </div>
              <span
                className={`mt-1 block text-[11px] font-medium ${
                  dark ? "text-white/70" : "text-slate-500"
                }`}
              >
                per live session
              </span>
            </div>

            <p className={`relative mt-3 text-xs ${dark ? "text-white/75" : "text-slate-500"}`}>
              {weeklyLessons} live lessons a week
            </p>

            {/* Feature list — fills the middle so cards feel substantial */}
            <ul className="relative mt-4 space-y-2 text-xs">
              {["Homework & marking", "Weekly quizzes", "Parent portal", "Cancel anytime"].map(
                (f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                        dark ? "bg-white/15 text-white" : "bg-[var(--accent-soft)] text-[var(--primary-deep)]"
                      }`}
                    >
                      <Check className="h-2.5 w-2.5" />
                    </span>
                    <span className={dark ? "text-white/85" : "text-slate-600"}>{f}</span>
                  </li>
                ),
              )}
            </ul>

            {/* Billed price + CTA pinned to the bottom */}
            <div
              className={`relative mt-auto border-t pt-4 ${dark ? "border-white/15" : "border-slate-100"}`}
            >
              <span className="font-display text-xl font-bold tracking-tight tabular-nums">
                {gbp(pence)}
              </span>
              <span className={`block text-[11px] ${dark ? "text-white/70" : "text-slate-500"}`}>
                {tier.billing}
              </span>
              <Link
                to="/auth"
                search={
                  {
                    mode: "signup",
                    tier: `${tier.cadence}_${count}`,
                    level: level_key,
                    subjects: chosenSubjects.join(","),
                    board,
                  } as never
                }
                className={`mt-3 block rounded-xl py-2.5 text-center text-sm font-bold transition-all duration-200 ${
                  dark
                    ? "bg-white text-[var(--primary-deep)] hover:bg-white/90 shadow-lg"
                    : "bg-primary text-primary-foreground hover:bg-[var(--primary-deep)]"
                }`}
              >
                Enrol
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A collapsing step in the plan builder — expanded shows the controls, closed
 *  shows a one-line summary you can click to reopen. */
function Step({
  index,
  title,
  summary,
  open,
  onOpen,
  last,
  children,
}: {
  index: number;
  title: string;
  summary: string;
  open: boolean;
  onOpen: () => void;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 px-6 py-5 text-left"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
            open ? "bg-primary text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          {index}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-slate-900">{title}</span>
          {!open && summary && (
            <span className="block truncate text-xs text-slate-500 mt-0.5">{summary}</span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {/* grid-rows 0fr→1fr gives a smooth height animation with no JS measuring */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className={`px-6 pb-6 ${last ? "" : ""}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Smooth sliding segmented toggle — a pill glides under the active option. */
function Slider({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div className="relative flex rounded-full bg-slate-100 p-1">
      <span
        aria-hidden
        className="absolute top-1 bottom-1 rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition-transform duration-300 ease-out"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${idx * 100}%)`,
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`relative z-10 flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors duration-200 ${
            value === o.value ? "text-[var(--primary-deep)]" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
