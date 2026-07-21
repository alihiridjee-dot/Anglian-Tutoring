import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, Target, RefreshCw, Check, Brain, Zap } from "lucide-react";

/**
 * "Moving screens" showcase: an auto-cycling trio of animated mock platform
 * screens that visualise how the curriculum works for a prospective student —
 *
 *   1. The Core      — full spec-point coverage across Bio/Chem/Physics, cells
 *                      popping into place to show nothing is left uncovered.
 *   2. Your Focus    — the personalised weekly planner: confidence sorts the
 *                      topics, and an AI plan is assembled around the weak spots.
 *   3. Stays Learnt  — spaced repetition: the forgetting curve draws itself and
 *                      timed reviews spike memory strength back up.
 *
 * The screens auto-advance every ~5.5s; the user can also click a tab. Each
 * activation bumps `runId` on the live screen so its inner animations replay.
 */

type ScreenId = "core" | "focus" | "repetition";

const SCREENS: {
  id: ScreenId;
  tab: string;
  icon: typeof Layers;
  eyebrow: string;
  title: string;
  blurb: string;
}[] = [
  {
    id: "core",
    tab: "The core curriculum",
    icon: Layers,
    eyebrow: "Complete coverage",
    title: "Every spec point, mapped and covered",
    blurb:
      "The full Biology, Chemistry and Physics specification is broken into tagged spec points — so you can see exactly what's covered, and nothing slips through.",
  },
  {
    id: "focus",
    tab: "Your focused plan",
    icon: Target,
    eyebrow: "Personalised weekly plan",
    title: "A plan built around what you find hard",
    blurb:
      "Rate your confidence each term and the platform sorts your topics, then builds a weekly plan that zeroes in on your weak spots first.",
  },
  {
    id: "repetition",
    tab: "It actually sticks",
    icon: RefreshCw,
    eyebrow: "Spaced repetition",
    title: "Reviews timed so it stays learnt",
    blurb:
      "Instead of cramming, topics resurface just as you're about to forget them. Each review resets the forgetting curve — memory that lasts to exam day.",
  },
];

const SUBJECTS = [
  { key: "bio", label: "Biology", color: "#10b981" },
  { key: "chem", label: "Chemistry", color: "#8b5cf6" },
  { key: "phys", label: "Physics", color: "#f59e0b" },
] as const;

/* ---------- Screen 1: The Core (spec-point coverage grid) ---------- */
function CoreScreen({ runId }: { runId: number }) {
  // 3 subject rows × columns of spec-point "cells" that pop into coverage.
  const cols = 11;
  return (
    <div key={runId} className="screen-in flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400">Curriculum coverage</p>
          <p className="font-display text-lg font-bold text-slate-800">GCSE Triple Science</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600">
          <Check className="h-3.5 w-3.5" /> 100% mapped
        </span>
      </div>

      <div className="flex flex-col gap-3.5">
        {SUBJECTS.map((s, si) => (
          <div key={s.key} className="flex items-center gap-3">
            <span
              className="w-20 shrink-0 text-right text-xs font-semibold"
              style={{ color: s.color }}
            >
              {s.label}
            </span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {Array.from({ length: cols }).map((_, ci) => (
                <span
                  key={ci}
                  className="cell-pop h-4 flex-1 rounded-[3px]"
                  style={
                    {
                      background: s.color,
                      opacity: 0.85,
                      minWidth: 10,
                      "--pop-delay": `${0.2 + si * 0.25 + ci * 0.045}s`,
                    } as React.CSSProperties
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
        {[
          { n: "395", l: "Spec points tagged" },
          { n: "3", l: "Exam boards aligned" },
          { n: "0", l: "Gaps left uncovered" },
        ].map((stat) => (
          <div key={stat.l} className="text-center">
            <p className="font-display text-xl font-bold text-slate-800">{stat.n}</p>
            <p className="text-[11px] leading-tight text-slate-400">{stat.l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Screen 2: Your Focus (confidence-sorted weekly plan) ---------- */
function FocusScreen({ runId }: { runId: number }) {
  // Topics sorted weakest-first; bar width = confidence. The weakest become
  // "this week's focus".
  const topics = [
    { name: "Required practicals", conf: 22, focus: true },
    { name: "Electrolysis", conf: 34, focus: true },
    { name: "Homeostasis", conf: 41, focus: true },
    { name: "Forces & motion", conf: 68, focus: false },
    { name: "Cell biology", conf: 84, focus: false },
  ];
  return (
    <div key={runId} className="screen-in flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400">Sorted by confidence</p>
          <p className="font-display text-lg font-bold text-slate-800">Your week ahead</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          <Brain className="h-3.5 w-3.5" /> AI planned
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {topics.map((t, i) => (
          <div key={t.name} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs font-medium text-slate-600">
              {t.name}
            </span>
            <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
              <div
                className="bar-grow h-full rounded-md"
                style={
                  {
                    width: `${t.conf}%`,
                    background: t.focus
                      ? "linear-gradient(90deg,#f59e0b,#ef4444)"
                      : "linear-gradient(90deg,#34d399,#10b981)",
                    "--grow-delay": `${0.25 + i * 0.12}s`,
                  } as React.CSSProperties
                }
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500">
                {t.conf}%
              </span>
            </div>
            {t.focus && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                <Zap className="h-3 w-3" /> Focus
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-1 rounded-xl border border-primary/15 bg-primary/[0.04] p-3.5">
        <p className="flex items-center gap-1.5 text-xs font-bold text-primary">
          <Target className="h-3.5 w-3.5" /> This week's focus
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
          We'll prioritise required practicals and electrolysis — your lowest-confidence topics — then
          check in to confirm they've clicked.
        </p>
      </div>
    </div>
  );
}

/* ---------- Screen 3: Spaced Repetition (forgetting curve + reviews) ---------- */
function RepetitionScreen({ runId }: { runId: number }) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const measure = useCallback((el: SVGPathElement | null) => {
    if (el) el.style.setProperty("--curve-len", String(el.getTotalLength()));
    pathRef.current = el;
  }, []);

  // A sawtooth memory curve: decays, then a review spikes it back to full.
  // Coordinates in a 0..320 × 0..140 viewBox (y inverted: small y = strong).
  const W = 320;
  const H = 140;
  const reviews = [70, 140, 215, 290]; // x positions where reviews happen
  // Build a path that decays between reviews and jumps back up at each review.
  let d = `M0,20`;
  let prevX = 0;
  reviews.forEach((rx) => {
    // decay curve from prevX (strong, y≈20) to just before rx (weak, y≈95)
    const midX = (prevX + rx) / 2;
    d += ` Q${midX},${18} ${rx - 2},95`;
    // vertical snap back up (review boosts memory)
    d += ` L${rx},20`;
    prevX = rx;
  });
  d += ` Q${(prevX + W) / 2},18 ${W},70`;

  return (
    <div key={runId} className="screen-in flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400">Memory strength over time</p>
          <p className="font-display text-lg font-bold text-slate-800">The forgetting curve, beaten</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          <RefreshCw className="h-3.5 w-3.5" /> Auto-scheduled
        </span>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
        <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" fill="none">
          <defs>
            <linearGradient id="mem-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2D8CFF" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#2D8CFF" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* gridlines */}
          {[20, 60, 100].map((y) => (
            <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#e2e8f0" strokeWidth="1" />
          ))}

          {/* fill under curve */}
          <path d={`${d} L${W},${H} L0,${H} Z`} fill="url(#mem-fill)" opacity="0.9" />

          {/* the sawtooth memory curve, draws itself */}
          <path
            ref={measure}
            d={d}
            className="curve-draw"
            stroke="#2D8CFF"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* review markers spike in as the curve reaches them */}
          {reviews.map((rx, i) => (
            <g
              key={rx}
              className="spike-in"
              style={{ "--spike-delay": `${0.5 + i * 0.4}s` } as React.CSSProperties}
            >
              <line x1={rx} y1="20" x2={rx} y2={H} stroke="#2D8CFF" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.4" />
              <circle cx={rx} cy="20" r="5" fill="#2D8CFF" />
              <text x={rx} y={H + 16} textAnchor="middle" className="fill-slate-400 text-[9px] font-semibold">
                Review {i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-100 bg-white p-3.5">
          <p className="font-display text-lg font-bold text-slate-800">4×</p>
          <p className="text-[11px] leading-tight text-slate-400">
            longer retention vs cramming once
          </p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3.5">
          <p className="font-display text-lg font-bold text-slate-800">Right before</p>
          <p className="text-[11px] leading-tight text-slate-400">
            you'd forget — that's when it resurfaces
          </p>
        </div>
      </div>
    </div>
  );
}

export function CurriculumShowcase() {
  const [active, setActive] = useState<ScreenId>("core");
  const [runId, setRunId] = useState(0);
  const [inView, setInView] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  // Reveal (animation replay) only while the section is on screen.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // No auto-advance: the trio is fully user-driven so prospective clients can
  // read each screen at their own pace and switch when they're ready.

  // Replay the inner animations whenever the active screen changes.
  useEffect(() => {
    setRunId((n) => n + 1);
  }, [active]);

  return (
    <section
      id="curriculum"
      ref={sectionRef}
      className="relative overflow-hidden border-t border-slate-100 bg-white py-20 lg:py-28"
    >
      {/* soft ambient blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
            HOW THE LEARNING WORKS
          </span>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Cover everything. Focus on what's hard. Never forget it.
          </h2>
          <p className="mt-4 text-slate-500">
            See the platform in motion — from full spec coverage, to a plan built around you, to
            spaced reviews that make it stick.
          </p>
        </div>

        <div className="grid items-center gap-10 lg:grid-cols-2">
          {/* Left: the moving screen inside a browser frame */}
          <div className="order-2 lg:order-1">
            <div className="float-y overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-elegant">
              {/* faux browser chrome */}
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                <span className="ml-3 rounded-md bg-white px-3 py-1 text-[11px] font-medium text-slate-400 ring-1 ring-slate-100">
                  app.anglianlearning.co.uk
                </span>
              </div>
              <div className="min-h-[360px] p-6">
                {active === "core" && <CoreScreen runId={runId} />}
                {active === "focus" && <FocusScreen runId={runId} />}
                {active === "repetition" && <RepetitionScreen runId={runId} />}
              </div>
            </div>

            {/* progress dots */}
            <div className="mt-5 flex justify-center gap-2">
              {SCREENS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  aria-label={`Show ${s.tab}`}
                  className={`h-1.5 rounded-full transition-all ${
                    active === s.id ? "w-8 bg-primary" : "w-2.5 bg-slate-200 hover:bg-slate-300"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Right: selectable tabs + description of the active screen */}
          <div className="order-1 flex flex-col gap-3 lg:order-2">
            {SCREENS.map((s) => {
              const Icon = s.icon;
              const isActive = s.id === active;
              return (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className={`group flex items-start gap-4 rounded-2xl border p-5 text-left transition-all duration-300 ${
                    isActive
                      ? "border-primary/30 bg-primary/[0.04] shadow-sm"
                      : "border-slate-100 bg-white hover:border-slate-200"
                  }`}
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
                      isActive ? "bg-primary text-white" : "bg-slate-50 text-slate-500"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-bold uppercase tracking-wide ${
                          isActive ? "text-primary" : "text-slate-400"
                        }`}
                      >
                        {s.eyebrow}
                      </span>
                    </span>
                    <span className="mt-0.5 block font-display text-base font-bold text-slate-800">
                      {s.title}
                    </span>
                    <span
                      className={`mt-1.5 block text-sm leading-relaxed text-slate-500 transition-all ${
                        isActive ? "max-h-40 opacity-100" : "max-h-0 overflow-hidden opacity-0 lg:max-h-40 lg:opacity-100"
                      }`}
                    >
                      {s.blurb}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
