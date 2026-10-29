import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Star, Stethoscope, GraduationCap, BookOpen } from "lucide-react";

import { Mascot } from "@/components/Doodles";

// Deterministic glitter field. Positions are hand-fixed (not Math.random) so the
// server and client render the exact same dots — otherwise React throws a
// hydration mismatch on this SSR'd page. Kept sparse and toward the edges so the
// centre stays clear behind the heading.
const GLITTER: { x: number; y: number; r: number; delay: number }[] = [
  { x: 6, y: 18, r: 1.5, delay: 0 },
  { x: 14, y: 62, r: 2, delay: 1.2 },
  { x: 9, y: 84, r: 1.2, delay: 2.4 },
  { x: 22, y: 32, r: 1.6, delay: 0.6 },
  { x: 28, y: 78, r: 1.3, delay: 3 },
  { x: 34, y: 12, r: 1.8, delay: 1.8 },
  { x: 41, y: 90, r: 1.4, delay: 0.9 },
  { x: 50, y: 6, r: 1.6, delay: 2.1 },
  { x: 59, y: 92, r: 1.3, delay: 1.5 },
  { x: 66, y: 14, r: 1.7, delay: 0.3 },
  { x: 72, y: 80, r: 1.5, delay: 2.7 },
  { x: 78, y: 34, r: 1.9, delay: 1.1 },
  { x: 86, y: 76, r: 1.3, delay: 3.3 },
  { x: 91, y: 60, r: 2, delay: 0.7 },
  { x: 94, y: 20, r: 1.4, delay: 2.2 },
  { x: 48, y: 40, r: 1, delay: 1.9 },
  { x: 55, y: 66, r: 1.1, delay: 2.6 },
  { x: 38, y: 54, r: 1, delay: 1.4 },
];

// Each ribbon drifts in from its own direction before settling into the cap.
// `d` is the path, and from-x/from-y/from-scale seed the converge keyframes.
const RIBBONS: {
  d: string;
  width: number;
  opacity: number;
  delay: number;
  from: { x: string; y: string; scale: number };
}[] = [
  // Nested mortarboard diamonds — expand outward from the centre, largest last.
  {
    d: "M0,-58 L112,-10 L0,38 L-112,-10 Z",
    width: 7,
    opacity: 0.9,
    delay: 0,
    from: { x: "0px", y: "-40px", scale: 1.4 },
  },
  {
    d: "M0,-82 L150,-14 L0,54 L-150,-14 Z",
    width: 5,
    opacity: 0.6,
    delay: 0.18,
    from: { x: "0px", y: "-60px", scale: 1.5 },
  },
  {
    d: "M0,-104 L186,-18 L0,70 L-186,-18 Z",
    width: 3.5,
    opacity: 0.38,
    delay: 0.36,
    from: { x: "0px", y: "-80px", scale: 1.6 },
  },
  // Cap band beneath the board, rising into place.
  {
    d: "M-70,6 C-70,44 -44,64 0,64 C44,64 70,44 70,6",
    width: 6.5,
    opacity: 0.85,
    delay: 0.5,
    from: { x: "0px", y: "50px", scale: 1.3 },
  },
  // Tassel: sweeps in from the right and settles on the button.
  {
    d: "M0,-10 C0,20 96,4 128,44 C138,58 138,74 130,90",
    width: 4.5,
    opacity: 0.8,
    delay: 0.68,
    from: { x: "70px", y: "0px", scale: 1.25 },
  },
];

/**
 * Decorative hero backdrop: symmetrical blue ribbons that draw themselves on,
 * sweeping in from the edges to converge into the outline of a graduation cap,
 * over a soft field of twinkling blue glitter. Purely aesthetic (aria-hidden)
 * and masked/faded so it never competes with the headline for legibility.
 *
 * `runId` remounts the animated nodes to replay the CSS animations from the
 * top — the hero animates on load and again each time it scrolls back into view.
 */
function GradCapRibbons({ runId }: { runId: number }) {
  // Stroke-dash draw-on needs each path's true length, which only the browser
  // knows. Measure on attach (re-runs on every replay, since the key remounts).
  const measure = useCallback((el: SVGPathElement | null) => {
    if (el) el.style.setProperty("--ribbon-len", String(el.getTotalLength()));
  }, []);

  return (
    <div aria-hidden className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
      {/* Glitter field, spread across the background below the site bar, so
          no blob sits behind a nav label. */}
      <svg
        className="absolute inset-x-0 bottom-0 w-full h-[calc(100%-var(--site-bar-h))]"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <defs>
          <radialGradient id="glint" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {GLITTER.map((g, i) => (
          <circle
            key={`${runId}-${i}`}
            cx={g.x}
            cy={g.y}
            r={g.r}
            fill="url(#glint)"
            className="glitter-dot"
            style={{ "--glitter-delay": `${0.6 + g.delay * 0.25}s` } as React.CSSProperties}
          >
            <animate
              attributeName="opacity"
              values="0.15;0.85;0.15"
              dur="4s"
              begin={`${1.5 + g.delay}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
      </svg>

      {/* Ribboned grad cap, centred behind the heading: 42% of the way down
          the part of the hero below the site bar. Radial mask fades the
          middle so text stays crisp; ribbons stay strongest at the edges. */}
      <svg
        className="absolute left-1/2 top-[calc(42%+0.58*var(--site-bar-h))] -translate-x-1/2 -translate-y-1/2 w-[46rem] max-w-[95vw] opacity-[0.5]"
        viewBox="-200 -160 400 320"
        fill="none"
      >
        <defs>
          <linearGradient
            id="ribbon"
            x1="-200"
            y1="0"
            x2="200"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0" />
            <stop offset="25%" stopColor="var(--primary)" stopOpacity="0.9" />
            <stop offset="50%" stopColor="var(--accent)" stopOpacity="1" />
            <stop offset="75%" stopColor="var(--primary)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="fadeCentre" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="55%" stopColor="white" stopOpacity="0.55" />
            <stop offset="100%" stopColor="white" stopOpacity="1" />
          </radialGradient>
          <mask id="edgeMask">
            <rect x="-200" y="-160" width="400" height="320" fill="url(#fadeCentre)" />
          </mask>
        </defs>

        <g stroke="url(#ribbon)" strokeLinecap="round" strokeLinejoin="round" mask="url(#edgeMask)">
          {RIBBONS.map((r, i) => (
            <g
              key={`${runId}-${i}`}
              className="ribbon-group"
              style={
                {
                  "--ribbon-delay": `${r.delay}s`,
                  "--from-x": r.from.x,
                  "--from-y": r.from.y,
                  "--from-scale": r.from.scale,
                } as React.CSSProperties
              }
            >
              <path
                ref={measure}
                d={r.d}
                strokeWidth={r.width}
                opacity={r.opacity}
                className="ribbon-path"
                style={{ "--ribbon-delay": `${r.delay}s` } as React.CSSProperties}
              />
            </g>
          ))}

          {/* Board button and tassel bead, fading in once their ribbons land. */}
          <circle
            key={`${runId}-button`}
            cx="0"
            cy="-10"
            r="6"
            fill="var(--accent)"
            stroke="none"
            opacity="0.9"
            className="glitter-dot"
            style={{ "--glitter-delay": "1.6s" } as React.CSSProperties}
          />
          <circle
            key={`${runId}-bead`}
            cx="130"
            cy="96"
            r="8"
            fill="var(--primary)"
            stroke="none"
            opacity="0.85"
            className="glitter-dot"
            style={{ "--glitter-delay": "2.2s" } as React.CSSProperties}
          />
        </g>
      </svg>
    </div>
  );
}

// The trust banner under the hero, drifting past like a "featured in" row.
// Every figure is one the site already makes elsewhere (the tutor bios, the
// 48-hour marking promise), so keep them in step if those change. The NHS line
// is words and a stethoscope, because the NHS logo is only for NHS
// organisations to use.
const TRUST_ITEMS: { text: string; mark: React.ReactNode }[] = [
  {
    text: "Loved by hundreds of students",
    mark: (
      <span className="trust-stars tint-amber" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} />
        ))}
      </span>
    ),
  },
  {
    text: "Practising NHS doctor",
    mark: <Stethoscope className="trust-icon tint-primary" aria-hidden />,
  },
  {
    text: "hours taught",
    mark: <span className="numeral trust-numeral tint-primary">1,500+</span>,
  },
  {
    text: "Led by experienced qualified tutors",
    mark: <GraduationCap className="trust-icon tint-accent" aria-hidden />,
  },
  {
    text: "marking turnaround",
    mark: <span className="numeral trust-numeral tint-primary">48h</span>,
  },
  {
    text: "years combined teaching experience",
    mark: <span className="numeral trust-numeral tint-primary">15+</span>,
  },
  {
    text: "AQA · Edexcel · OCR",
    mark: <BookOpen className="trust-icon tint-accent" aria-hidden />,
  },
];

function TrustMarquee() {
  return (
    <div className="trust-banner relative z-20 mt-10">
      <div className="trust-marquee">
        {/* The second half is the same list again, so the loop has no seam;
            screen readers skip it and read each line once. */}
        {[0, 1].map((half) => (
          <ul key={half} className="trust-marquee-half" aria-hidden={half === 1 || undefined}>
            {TRUST_ITEMS.map((item) => (
              <li key={item.text} className="trust-item">
                {item.mark} <span>{item.text}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export function Hero() {
  const sectionRef = useRef<HTMLElement | null>(null);
  // Bumping runId remounts the ribbon nodes, restarting their CSS animations.
  // Starts at 0 so the sequence also plays on first load / refresh.
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      ([entry]) => {
        // Replay only on a fresh entry — leaving and coming back re-triggers it,
        // but small scroll jitters inside the hero don't.
        if (entry.isIntersecting) setRunId((n) => n + 1);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      id="top"
      ref={sectionRef}
      // Tighter on a phone turned sideways, so "Get started" makes the first
      // screen rather than the second.
      className="page-aurora relative overflow-hidden py-20 lg:py-32 short:pt-5 short:pb-8"
    >
      {/* Background with faded science images reflecting the specialities */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        {/* Radial wash for smooth edges and text contrast. Mostly opaque canvas
            — the photo layer below is atmosphere, not subject matter, and the
            headline has to stay crisp over it. */}
        <div className="absolute inset-0 z-10 bg-[radial-gradient(45rem_50rem_at_top,color-mix(in_oklab,var(--primary)_8%,var(--background)),var(--background))] opacity-90" />

        {/* Subtle, beautiful faded background images reflecting lab / physics / astronomy */}
        <div className="absolute inset-0 opacity-[0.09] z-0">
          {/* The left-hand lab photo was taken down at its source (it now
              answers 404), so only the right-hand one is left. */}
          <img
            src="https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&w=1600&q=80"
            alt="Physics & Light Equations"
            className="w-1/2 h-full object-cover absolute right-0 top-0 select-none pointer-events-none filter blur-[2px]"
            referrerPolicy="no-referrer"
          />
          {/* Blend gradient down the center */}
          <div className="absolute inset-y-0 left-1/3 right-1/3 bg-gradient-to-r from-transparent via-white to-transparent" />
        </div>
      </div>

      {/* Ribboned grad-cap + glitter backdrop (sits above the image layer,
          below the content). */}
      <GradCapRibbons runId={runId} />

      <div className="relative z-20 mx-auto max-w-4xl px-4 pt-(--site-bar-h) text-center sm:px-6">
        <span className="sticker stamp-in">
          <Sparkles className="size-3.5 text-[color:var(--pop-ink)]" aria-hidden /> Modern science
          platform for KS3 &amp; GCSE
        </span>

        {/* The highlighter goes on the one word the whole page is about. A
            second marker anywhere on this screen and neither would land. */}
        <h1 className="font-display text-foreground mx-auto mt-8 max-w-3xl text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl lg:text-6xl short:mt-3 short:text-4xl">
          Better grades in <span className="marker">science</span>, taught by teachers who care.
        </h1>

        <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg leading-relaxed short:mt-2 short:text-base">
          Weekly live lessons in Biology, Chemistry, and Physics, aligned to Edexcel, AQA, and OCR.
          Interactive quizzes, marked tasks, and a grade predictor that actually reflects your
          progress.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-4 short:mt-4">
          <Link
            to="/auth"
            search={{ mode: "signup" } as never}
            className="btn-hero group inline-flex cursor-pointer items-center gap-2 rounded-xl px-7 py-3.5"
          >
            Get started{" "}
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
          <Link
            to="/demo"
            className="btn-soft inline-flex cursor-pointer items-center gap-2 rounded-xl px-7 py-3.5"
          >
            <Sparkles className="text-accent size-4" aria-hidden />
            Try Demo Platform
          </Link>
        </div>

        {/* The cast, one per science, introduced once at the top of the site so
            the characters further down read as familiar rather than random.
            They rise in behind the buttons after the ribbons have landed. */}
        <div className="peek-in mt-12 flex items-end justify-center gap-2 sm:gap-6">
          <Mascot name="cell" mood="happy" size={72} className="sm:size-[92px]" />
          <Mascot name="flask" mood="wink" size={84} className="sm:size-[108px]" />
          <Mascot name="bolt" mood="wow" size={72} className="sm:size-[92px]" />
        </div>
      </div>

      {/* Social proof + trust ticks, full width so the strip runs edge to edge. */}
      <TrustMarquee />
    </section>
  );
}
