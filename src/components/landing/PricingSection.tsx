import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SectionSeam } from "@/components/landing/SectionSeam";
import { useCurriculumCoverage } from "@/hooks/data/useCurriculumCoverage";
import { boardLabel } from "@/lib/curriculum/courseSummary";
import { isBoard, isSubject, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import {
  BEST_VALUE_CADENCE,
  BEST_VALUE_LABEL,
  WEEKS_PER_CYCLE,
  priceLadderFor,
  type Cadence,
  type PriceLadder,
  type SubjectCount as Count,
} from "@/lib/billing/entitlements";

// ---------------------------------------------------------------------------
// Pricing model
//
// A plan is built from three choices — level (KS3 / GCSE / International GCSE /
// A-Level), how many subjects, and cadence — plus a board that is captured but
// never affects price. KS3, GCSE and International GCSE cost the same; A-Level
// costs 10% more. Combined-Science Trilogy is a GCSE-only qualification that
// always counts as three subjects.
//
// International GCSE is a level, not a board: every board runs one, and it is a
// different qualification from the domestic GCSE, so it carries its own spec and
// its own package ladder rather than sharing GCSE's. A-Level has its own ladder
// for the same reason, and its own prices.
//
// The prices live in GENERAL_PRICE_PENCE and ALEVEL_PRICE_PENCE (shared with
// the Stripe seed script, so the page and the charge can't drift). Monthly is
// the anchor the business sets directly. Weekly and Termly are derived from it
// with the ratios baked into the original 1-subject prices (weekly ≈ monthly ×
// 0.4, termly ≈ monthly × 2.8), rounded to a clean .99. Numbers are stored in
// pence to avoid float drift.
//
// Live sessions scale at 1 per subject per week, so per-session equivalence
// falls as students add subjects — that lower number is the headline value.
// ---------------------------------------------------------------------------

type PricingLevel = "ks3" | "gcse" | "igcse" | "alevel";

// Each plan is a stop on the price trail: its emoji sits in the stop, and its
// tint colours the stop, the card it opens and that card's Enrol button. The
// highlighted plan is the one picked when the page opens.
const CADENCES: {
  cadence: Cadence;
  name: string;
  billing: string;
  badge: string;
  emoji: string;
  tint: string;
  highlight: boolean;
}[] = [
  {
    cadence: "weekly",
    name: "Weekly",
    billing: "per week",
    badge: "Flexible",
    emoji: "🤸",
    tint: "tint-primary",
    highlight: false,
  },
  {
    cadence: "monthly",
    name: "Monthly Saver",
    billing: "per month",
    badge: "Saving",
    emoji: "💰",
    tint: "tint-accent",
    highlight: true,
  },
  // "Best value" goes on BEST_VALUE_CADENCE, shared with the plan step, so the
  // badges below are what each card says when it isn't that one.
  {
    cadence: "termly",
    name: "Termly",
    billing: "per term",
    badge: "Saving",
    emoji: "🏆",
    tint: "tint-rose",
    highlight: false,
  },
];

// The same for every plan, so it is said once, in the picked plan's card.
const INCLUDED = [
  { emoji: "✏️", text: "Tasks & marking" },
  { emoji: "🧪", text: "Weekly quizzes" },
  { emoji: "👪", text: "Parent portal" },
  { emoji: "👋", text: "Cancel anytime" },
];

// Maths is the one subject not taught at all yet. Whether a science is taught at
// the chosen level comes from curriculum coverage (below), not from this list.
const SUBJECTS = [
  { id: "biology", label: "Biology", comingSoon: false },
  { id: "chemistry", label: "Chemistry", comingSoon: false },
  { id: "physics", label: "Physics", comingSoon: false },
  { id: "maths", label: "Maths", comingSoon: true },
] as const;

// Boards in the order this page offers them. Which of them appear depends on
// the level: coverage decides, so a parent is never offered a board that
// onboarding would then move their child off. KS3 is not a level the
// curriculum is keyed by, so it has no coverage to consult and keeps the
// domestic boards — as does every level while coverage is still loading.
const BOARD_ORDER: readonly BoardV[] = ["aqa", "edexcel", "ocr", "cambridge", "oxford_aqa"];
const DOMESTIC_BOARDS: readonly BoardV[] = ["aqa", "edexcel", "ocr"];

const gbp = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PricingSection() {
  const [level, setLevel] = useState<PricingLevel>("gcse");
  const [trilogy, setTrilogy] = useState(false);
  const [subjects, setSubjects] = useState<string[]>(["biology"]);
  const [board, setBoard] = useState<BoardV>("aqa");
  const [openStep, setOpenStep] = useState<0 | 1 | 2>(0);
  const { coverage } = useCurriculumCoverage();

  const isTrilogy = level === "gcse" && trilogy;

  // The curriculum this plan would be taught from — null for KS3, which has none.
  const curriculumLevel: LevelV | null =
    level === "ks3"
      ? null
      : level === "igcse" || level === "alevel"
        ? level
        : isTrilogy
          ? "gcse_trilogy"
          : "gcse";

  /** Taught at the chosen level under some board. Ungated until coverage lands. */
  const taught = (id: string): boolean =>
    isSubject(id) &&
    (curriculumLevel === null ||
      coverage.isEmpty ||
      coverage.boardsForSubject(curriculumLevel, id).length > 0);

  // What is picked *and* taught here. Derived rather than written back, so a
  // parent who picks Physics, tries International and comes back still has it.
  const pickedAndTaught = subjects.filter(taught);
  const firstTaught = SUBJECTS.find((s) => !s.comingSoon && taught(s.id))?.id;
  const liveSubjects = pickedAndTaught.length ? pickedAndTaught : firstTaught ? [firstTaught] : [];

  const count = (isTrilogy ? 3 : Math.max(1, liveSubjects.length)) as Count;

  const toggleSubject = (id: string) => {
    setTrilogy(false);
    setSubjects(
      liveSubjects.includes(id)
        ? liveSubjects.length === 1
          ? liveSubjects
          : liveSubjects.filter((s) => s !== id)
        : [...liveSubjects, id],
    );
  };

  const chosenSubjects = isTrilogy ? ["biology", "chemistry", "physics"] : liveSubjects;

  // Boards that teach every chosen subject at this level; failing that, any
  // board teaching at this level, so the step is never empty.
  const boardOptions: readonly BoardV[] = (() => {
    if (curriculumLevel === null || coverage.isEmpty) return DOMESTIC_BOARDS;
    const atLevel = BOARD_ORDER.filter((b) => coverage.boardsFor(curriculumLevel).includes(b));
    const forAll = atLevel.filter((b) =>
      chosenSubjects.every((s) => isSubject(s) && coverage.has(curriculumLevel, b, s)),
    );
    return forAll.length ? forAll : atLevel.length ? atLevel : DOMESTIC_BOARDS;
  })();
  const liveBoard: BoardV = boardOptions.includes(board) ? board : (boardOptions[0] ?? "aqa");

  // Sign-up carries this to onboarding, which preselects it when it names a
  // real level (alevel, igcse, gcse_trilogy do; ks3 and gcse_separate don't).
  const level_key =
    level === "ks3" || level === "igcse" || level === "alevel"
      ? level
      : isTrilogy
        ? "gcse_trilogy"
        : "gcse_separate";

  const subjectsSummary = isTrilogy
    ? "Combined Trilogy"
    : SUBJECTS.filter((s) => liveSubjects.includes(s.id))
        .map((s) => s.label)
        .join(", ");

  return (
    <section id="pricing" className="relative pb-24 lg:pb-28 overflow-hidden bg-secondary">
      {/* Ambient premium backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--accent-soft)_0%,transparent_55%)] opacity-60"
      />
      {/* After the backdrop, so the wash shows through the blocks and not the
          gaps. The gaps are the platform section's bg-secondary/50 over the
          page's own. */}
      <SectionSeam
        from="color-mix(in srgb, var(--secondary) 70%, var(--background))"
        className="mb-16 lg:mb-20"
      />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="sticker">
            <Sparkles className="size-3.5" aria-hidden /> Build your plan
          </span>
          <h2 className="font-display text-foreground mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">
            A plan that <span className="marker">fits your child</span>
          </h2>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Choose what suits them and watch the price update as you go. Cancel anytime.
          </p>
        </div>

        {/* ---- Banner: builder and live pricing side by side ---- */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-10 items-stretch">
          {/* Plan builder: a guided, collapsing three-step card */}
          <div className="premium-card rounded-3xl backdrop-blur-xl divide-y divide-border overflow-hidden lg:sticky lg:top-24">
            <Step
              index={1}
              title="What level?"
              summary={
                level === "ks3"
                  ? "KS3 (Years 7–9)"
                  : level === "igcse"
                    ? "International GCSE"
                    : level === "alevel"
                      ? "A-Level"
                      : isTrilogy
                        ? "GCSE · Trilogy"
                        : "GCSE"
              }
              open={openStep === 0}
              onOpen={() => setOpenStep(0)}
            >
              <Slider
                options={[
                  { value: "ks3", label: "KS3" },
                  { value: "gcse", label: "GCSE" },
                  { value: "igcse", label: "IGCSE" },
                  { value: "alevel", label: "A-Level" },
                ]}
                value={level}
                onChange={(v) => {
                  const next = v as PricingLevel;
                  setLevel(next);
                  if (next !== "gcse") {
                    setTrilogy(false);
                    // Let the toggle finish its slide before the step collapses.
                    window.setTimeout(() => setOpenStep(1), 340);
                  }
                }}
              />
              {level === "igcse" && (
                <p className="mt-3 text-xs text-muted-foreground/70">
                  International GCSE is a separate qualification from the UK GCSE, with its own
                  specification — we teach it from its own spec, on your child's own board.
                </p>
              )}
              {level === "gcse" && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
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
                    className="mt-4 w-full min-h-11 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition-colors sm:pointer-fine:min-h-0"
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
                  const soon = s.comingSoon || !taught(s.id);
                  const on = !soon && (isTrilogy || liveSubjects.includes(s.id));
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={isTrilogy || soon}
                      onClick={() => toggleSubject(s.id)}
                      className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-2xl border px-3 py-4 text-sm font-semibold transition-all duration-200 ${
                        soon
                          ? "border-border bg-secondary text-muted-foreground/70 cursor-not-allowed"
                          : on
                            ? "border-primary bg-primary/[0.06] text-[var(--primary-deep)] shadow-sm cursor-pointer"
                            : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:-translate-y-0.5 cursor-pointer"
                      } ${isTrilogy && !soon ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {soon && (
                        <span className="absolute right-2 top-2 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                          Soon
                        </span>
                      )}
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                          on
                            ? "border-primary bg-primary text-white"
                            : "border-border text-transparent"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground/70">
                {isTrilogy
                  ? "Combined Trilogy covers all three sciences in one course."
                  : "Choose one or more — price adjusts automatically."}
              </p>
              <p className="mt-1.5 text-xs font-medium text-[var(--primary-deep)]/70">
                Maths coming soon — we're building out our team of specialists!
              </p>
              <button
                type="button"
                onClick={() => setOpenStep(2)}
                className="mt-4 w-full min-h-11 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition-colors sm:pointer-fine:min-h-0"
              >
                Continue
              </button>
            </Step>

            <Step
              index={3}
              title="Exam board"
              summary={boardLabel(liveBoard)}
              open={openStep === 2}
              onOpen={() => setOpenStep(2)}
              last
            >
              <Slider
                options={boardOptions.map((b) => ({ value: b, label: boardLabel(b) }))}
                value={liveBoard}
                onChange={(v) => isBoard(v) && setBoard(v)}
              />
              <p className="mt-3 text-xs text-muted-foreground/70">
                The board never changes your price.
              </p>
            </Step>
          </div>

          {/* Live pricing: the plans as a trail, the picked one in a card that
              grows to the builder's height (items-stretch) */}
          <PricingTiers
            ladder={priceLadderFor(curriculumLevel)}
            count={count}
            level_key={level_key}
            chosenSubjects={chosenSubjects}
            board={liveBoard}
          />
        </div>
      </div>
    </section>
  );
}

/** Live pricing as a trail, the spec point page's pattern (README, "A page of
 *  work is a trail"): each way of paying is a round stop on a dotted line, with
 *  its price per live session underneath, so the three can still be compared
 *  at a glance. The picked plan opens in one card below, with what it costs
 *  each time it is billed and its Enrol button. The column is h-full and the
 *  card grows, so its foot lines up with the builder beside it. */
function PricingTiers({
  ladder,
  count,
  level_key,
  chosenSubjects,
  board,
}: {
  ladder: PriceLadder;
  count: Count;
  level_key: string;
  chosenSubjects: string[];
  board: string;
}) {
  const [picked, setPicked] = useState<Cadence>(
    () => CADENCES.find((t) => t.highlight)?.cadence ?? "monthly",
  );
  const tier = CADENCES.find((t) => t.cadence === picked) ?? CADENCES[0];
  const isBest = tier.cadence === BEST_VALUE_CADENCE;
  const included = [
    {
      emoji: "🎥",
      text: `${count} live ${count === 1 ? "session" : "sessions"} a week · 1 per subject`,
    },
    ...INCLUDED,
  ];

  return (
    <div className="flex h-full flex-col">
      <div
        role="tablist"
        aria-label="How often you pay"
        className="point-trail price-trail"
        style={{ "--stops": CADENCES.length } as CSSProperties}
      >
        <svg
          aria-hidden
          className="point-trail-path"
          viewBox="0 0 200 40"
          preserveAspectRatio="none"
        >
          <path
            d="M0 20 C30 4 70 36 100 20 C130 36 170 4 200 20"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {CADENCES.map((t) => {
          // One live session per subject per week, over the shared weeks per cycle.
          const perSession = ladder[t.cadence][count] / (WEEKS_PER_CYCLE[t.cadence] * count);
          return (
            <button
              key={t.cadence}
              type="button"
              role="tab"
              id={`price-stop-${t.cadence}`}
              aria-selected={t.cadence === picked}
              aria-controls="price-panel"
              onClick={() => setPicked(t.cadence)}
              className={`point-stop ${t.tint}`}
            >
              {t.cadence === BEST_VALUE_CADENCE && (
                <span className="sticker stamp-in price-sticker">{BEST_VALUE_LABEL}</span>
              )}
              <span className="point-stop-dot">
                <span aria-hidden>{t.emoji}</span>
              </span>
              <span className="point-stop-label">{t.name}</span>
              <Price pence={Math.round(perSession)} trim className="numeral price-each" />
              <span className="price-per">per live session</span>
            </button>
          );
        })}
      </div>

      <div
        key={tier.cadence}
        id="price-panel"
        role="tabpanel"
        aria-labelledby={`price-stop-${tier.cadence}`}
        className={`point-panel premium-card ${tier.tint} flex flex-1 flex-col p-5 sm:p-7`}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h3 className="text-foreground text-3xl leading-tight font-extrabold">{tier.name}</h3>
            <svg
              aria-hidden
              className="point-squiggle"
              viewBox="0 0 100 12"
              preserveAspectRatio="none"
            >
              <path d="M2 8 Q 18 1 34 7 T 66 6 T 98 5" vectorEffect="non-scaling-stroke" />
            </svg>
            {!isBest && <p className="price-word mt-2 text-[1.0625rem] font-bold">{tier.badge}</p>}
          </div>
          <p className="flex items-baseline gap-2">
            <Price pence={ladder[tier.cadence][count]} className="numeral price-bill" />
            <span className="text-lg font-bold">{tier.billing}</span>
          </p>
        </div>

        <ul className="price-included mt-6 grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {included.map((f) => (
            <li key={f.emoji}>
              <span aria-hidden className="price-emoji">
                {f.emoji}
              </span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-6">
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
            className="btn-solid flex min-h-12 items-center justify-center rounded-2xl px-5 py-3 text-base font-bold"
          >
            Enrol
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A price that rolls from the figure it showed to a new one, with a little
 *  bump as it lands, so a parent sees it change as they build the plan. `trim`
 *  drops a whole pound's ".00". Under reduced motion it just changes. */
function Price({ pence, trim, className }: { pence: number; trim?: boolean; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const [shown, setShown] = useState(pence);
  const shownRef = useRef(pence);

  useEffect(() => {
    const from = shownRef.current;
    if (reduce || from === pence) {
      shownRef.current = pence;
      setShown(pence);
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 650);
      shownRef.current = Math.round(from + (pence - from) * (1 - Math.pow(1 - p, 3)));
      setShown(shownRef.current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [pence, reduce]);

  const text = gbp(shown);
  // Keyed on the target, so the bump replays each time the price moves.
  return (
    <span key={pence} className={`price-bump ${className ?? ""}`}>
      {trim ? text.replace(".00", "") : text}
    </span>
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
        className="flex w-full items-center gap-4 px-5 py-4 text-left sm:px-6 sm:py-5"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
            open ? "bg-primary text-white" : "bg-secondary text-muted-foreground"
          }`}
        >
          {index}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-foreground">{title}</span>
          {!open && summary && (
            <span className="block truncate text-xs text-muted-foreground mt-0.5">{summary}</span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-300 ${
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
          <div className={`px-5 pb-5 sm:px-6 sm:pb-6 ${last ? "" : ""}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Smooth sliding segmented toggle — a pill glides under the active option.
 *  Labels keep to one line, so a long one ("A-Level") makes its slot
 *  wider than the rest; the pill therefore follows the active button's own
 *  measured box, falling back to equal slots before the first measurement
 *  (server render). */
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
  const rowRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const labels = options.map((o) => o.label).join("|");

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const place = () => {
      const active = row.querySelectorAll<HTMLButtonElement>("button")[idx];
      if (active) setBox({ left: active.offsetLeft, width: active.offsetWidth });
    };
    place();
    // The buttons as well as the row: a late web font resizes the labels
    // without changing the row's width.
    const resize = new ResizeObserver(place);
    resize.observe(row);
    row.querySelectorAll("button").forEach((b) => resize.observe(b));
    return () => resize.disconnect();
  }, [idx, labels]);

  return (
    <div ref={rowRef} className="relative flex rounded-full bg-secondary p-1">
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-0 rounded-full bg-card shadow-sm ring-1 ring-border transition-[transform,width] duration-300 ease-out"
        style={
          box
            ? { width: box.width, transform: `translateX(${box.left}px)` }
            : {
                width: `calc((100% - 0.5rem) / ${options.length})`,
                transform: `translateX(calc(0.25rem + ${idx * 100}%))`,
              }
        }
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`relative z-10 min-h-11 flex-1 whitespace-nowrap rounded-full px-2 py-2 text-sm leading-tight font-semibold transition-colors duration-200 sm:pointer-fine:min-h-0 sm:px-3 ${
            value === o.value
              ? "text-[var(--primary-deep)]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
