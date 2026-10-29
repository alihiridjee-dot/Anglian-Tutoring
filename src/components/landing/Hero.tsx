import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Star, Stethoscope, GraduationCap, BookOpen } from "lucide-react";

import { BenchDoodles } from "@/components/landing/BenchDoodles";

// The hero photo: a student in goggles smiling over a lab table full of
// coloured cylinders. From Pexels (pexels.com/photo/8325981), free to use with
// no credit required. It is served from /public so it can't vanish at its
// source the way an old hotlinked hero photo did. Every coordinate below is in
// its 1600 × 1200 frame, which is how the drawings stay on her head, on the
// cylinder and on the table however the photo is cropped.
const PHOTO_WIDTHS = [960, 1600, 2400];

// The hero's side-by-side layout: a wide screen, or a phone on its side. Keep
// in step with the `split` variant and `.hero-photo-stage` in styles.css.
const SPLIT = "(min-width: 64rem), (max-height: 31.25rem) and (min-width: 40rem)";

/**
 * Whether the hero is side by side, or null before the page has hydrated. The
 * doodles only stand on the table side by side (a phone's copy covers it), so
 * they wait for this; they start out of sight anyway, so nothing jumps.
 */
function useSplitLayout() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(SPLIT);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(SPLIT).matches,
    () => null,
  );
}

// Sparkles that twinkle round the cap and the cylinder once they have landed.
// Hand-placed (not Math.random) so the server and client render the same dots,
// otherwise React throws a hydration mismatch on this SSR'd page.
const GLITTER: { x: number; y: number; r: number; delay: number }[] = [
  { x: 548, y: 130, r: 12, delay: 0 },
  { x: 1196, y: 84, r: 10, delay: 1.2 },
  { x: 1232, y: 236, r: 11, delay: 2.1 },
  { x: 720, y: 24, r: 8, delay: 0.6 },
  { x: 1020, y: 20, r: 7, delay: 1.8 },
  { x: 1136, y: 372, r: 9, delay: 0.9 },
  { x: 1292, y: 476, r: 8, delay: 2.6 },
  { x: 1292, y: 980, r: 7, delay: 1.5 },
];

// Each ribbon draws itself on while drifting in from its own direction, then
// settles. `d` is the path, and from-x/from-y/from-scale seed the converge
// keyframes.
type Ribbon = {
  d: string;
  width: number;
  delay: number;
  from: { x: string; y: string; scale: number };
  // Seconds to draw, if not the slow 1.9 s default.
  dur?: number;
  // Drops into place with a small bounce, rather than gliding.
  land?: boolean;
  // A gradient or colour for the stroke, if not the set's own.
  stroke?: string;
  // Colours in once its outline is drawn (the cap's board and crown).
  fill?: string;
  // Not drawn on: flashes out from where it sits and fades.
  pulse?: boolean;
};

const CAP_BOARD = "M0,-58 L112,-10 L0,38 L-112,-10 Z";

// The grad cap, in its own frame centred on the board. GradCapRibbons places it
// on her head. It builds from the top down, in about a second: the board lands
// first (a ring flashes out as it does), the crown slides down out from under
// it, then the tassel drops from the button.
const CAP_RIBBONS: Ribbon[] = [
  // The crown, round the top of her head. First in paint order, so the board
  // covers its top, but drawn second.
  {
    d: "M-70,6 L-66,56 C-30,68 30,68 66,56 L70,6",
    width: 3.5,
    delay: 0.28,
    dur: 0.45,
    from: { x: "0px", y: "-14px", scale: 0.96 },
    fill: "url(#cap-crown)",
  },
  // The board, drawn from its top corner.
  {
    d: CAP_BOARD,
    width: 4.5,
    delay: 0,
    dur: 0.5,
    from: { x: "0px", y: "-30px", scale: 1.1 },
    fill: "url(#cap-board)",
    land: true,
  },
  {
    d: CAP_BOARD,
    width: 3,
    delay: 0.36,
    from: { x: "0px", y: "0px", scale: 1 },
    pulse: true,
  },
  // Tassel: swings down from the button towards the red cylinder.
  {
    d: "M0,-10 C0,20 96,4 128,44 C138,58 138,74 130,90",
    width: 3.5,
    delay: 0.62,
    dur: 0.45,
    from: { x: "12px", y: "-8px", scale: 1.04 },
  },
];

// Bubbles rising to the top of the red liquid in the cylinder beside her face,
// once the cap is on.
const BUBBLES: { x: number; y: number; r: number; delay: number }[] = [
  { x: 1194, y: 704, r: 5, delay: 0 },
  { x: 1220, y: 712, r: 4, delay: 0.7 },
  { x: 1240, y: 700, r: 6, delay: 1.3 },
  { x: 1206, y: 694, r: 3.5, delay: 1.9 },
];

function Ribbons({ ribbons, runId, stroke }: { ribbons: Ribbon[]; runId: number; stroke: string }) {
  // Stroke-dash draw-on needs each path's true length, which only the browser
  // knows. Measure on attach (re-runs on every replay, since the key remounts).
  const measure = useCallback((el: SVGPathElement | null) => {
    if (el) el.style.setProperty("--ribbon-len", String(el.getTotalLength()));
  }, []);

  return ribbons.map((r, i) =>
    r.pulse ? (
      <path
        key={`${runId}-${i}`}
        d={r.d}
        stroke={r.stroke ?? stroke}
        strokeWidth={r.width}
        className="ribbon-pulse"
        style={{ "--ribbon-delay": `${r.delay}s` } as React.CSSProperties}
      />
    ) : (
      <g
        key={`${runId}-${i}`}
        className="ribbon-group"
        style={
          {
            "--ribbon-delay": `${r.delay}s`,
            "--from-x": r.from.x,
            "--from-y": r.from.y,
            "--from-scale": r.from.scale,
            ...(r.dur && { "--ribbon-dur": `${r.dur}s`, "--converge-dur": `${r.dur * 1.1}s` }),
            ...(r.land && { "--converge-ease": "cubic-bezier(0.34, 1.56, 0.64, 1)" }),
          } as React.CSSProperties
        }
      >
        <path
          ref={measure}
          d={r.d}
          stroke={r.stroke ?? stroke}
          strokeWidth={r.width}
          fill={r.fill ?? "none"}
          className={r.fill ? "ribbon-path ribbon-filled" : "ribbon-path"}
          style={{ "--ribbon-delay": `${r.delay}s` } as React.CSSProperties}
        />
      </g>
    ),
  );
}

/**
 * Blue ribbons build a graduation cap on her head, from the top down, each
 * piece colouring in as its outline closes.
 */
function GradCapRibbons({ runId }: { runId: number }) {
  return (
    <g transform="translate(870 159) rotate(4) scale(2.6 2.1)">
      <Ribbons ribbons={CAP_RIBBONS} runId={runId} stroke="url(#cap-ribbon)" />

      {/* Board button and tassel bead, fading in once their ribbons land. */}
      <circle
        key={`${runId}-button`}
        cx="0"
        cy="-10"
        r="5"
        fill="var(--accent)"
        className="glitter-dot"
        style={{ "--glitter-delay": "0.5s" } as React.CSSProperties}
      />
      <circle
        key={`${runId}-bead`}
        cx="130"
        cy="96"
        r="6.5"
        fill="var(--primary)"
        className="glitter-dot"
        style={{ "--glitter-delay": "0.95s" } as React.CSSProperties}
      />
    </g>
  );
}

/** Bubbles rising through the red cylinder beside her, once the cap is on. */
function CylinderBubbles({ runId }: { runId: number }) {
  return BUBBLES.map((b, i) => (
    <circle
      key={`${runId}-bubble-${i}`}
      cx={b.x}
      cy={b.y}
      r={b.r}
      fill="white"
      fillOpacity="0.55"
      stroke="var(--accent)"
      strokeWidth="2"
      className="flask-bubble"
      style={{ "--bubble-delay": `${1 + b.delay}s` } as React.CSSProperties}
    />
  ));
}

/**
 * The photo, with the cap drawn on it, bubbles in its cylinder and, side by
 * side, the doodles on its table. All of it shares one 4:3 stage, sized like
 * `object-fit: cover`, so the drawings move with the photo (see `.hero-photo`
 * in styles.css). The drawings are decoration (aria-hidden); the photo's alt
 * says what it shows.
 *
 * `runId` remounts the animated nodes to replay the animations from the top —
 * the hero animates on load and again each time it scrolls back into view.
 */
function HeroPhoto({ runId, doodles }: { runId: number; doodles: boolean }) {
  return (
    <div className="hero-photo absolute inset-x-0 top-(--site-bar-h) bottom-0">
      <div className="hero-photo-stage">
        <img
          src="/hero/student-smile-1600.webp"
          srcSet={PHOTO_WIDTHS.map((w) => `/hero/student-smile-${w}.webp ${w}w`).join(", ")}
          sizes="(min-width: 1024px) 70vw, 230vw"
          width={1600}
          height={1200}
          alt="A smiling student in safety goggles behind a lab table of coloured measuring cylinders"
          fetchPriority="high"
          draggable={false}
          className="hero-photo-img absolute inset-0 size-full select-none"
        />
        <svg
          aria-hidden
          viewBox="0 0 1600 1200"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
        >
          <defs>
            {/* Cap strokes run in the cap's own frame. */}
            <linearGradient
              id="cap-ribbon"
              x1="-200"
              y1="0"
              x2="200"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="var(--primary)" />
              <stop offset="50%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--primary)" />
            </linearGradient>
            <linearGradient id="cap-board" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                style={{
                  stopColor: "color-mix(in oklab, var(--primary) 60%, var(--primary-deep))",
                }}
              />
              <stop offset="100%" stopColor="var(--primary-deep)" />
            </linearGradient>
            <linearGradient id="cap-crown" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                style={{ stopColor: "color-mix(in oklab, var(--primary-deep) 70%, black)" }}
              />
              <stop offset="100%" stopColor="var(--primary-deep)" />
            </linearGradient>
            <radialGradient id="glint" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="45%" stopColor="var(--accent)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </radialGradient>
          </defs>

          <GradCapRibbons runId={runId} />
          <CylinderBubbles runId={runId} />

          {GLITTER.map((g, i) => (
            <circle
              key={`${runId}-glint-${i}`}
              cx={g.x}
              cy={g.y}
              r={g.r}
              fill="url(#glint)"
              className="glitter-dot"
              style={{ "--glitter-delay": `${1 + g.delay * 0.25}s` } as React.CSSProperties}
            >
              <animate
                attributeName="opacity"
                values="0.2;1;0.2"
                dur="3s"
                begin={`${1.8 + g.delay}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </svg>

        {/* The cast, grouped on the table in front of her hands. */}
        {doodles ? (
          <div className="absolute bottom-[4.2%] left-[38.5%] h-[13.5%] w-[28.1%]">
            <BenchDoodles key={runId} />
          </div>
        ) : null}
      </div>
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
    <div className="trust-banner relative z-20">
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
  const split = useSplitLayout();

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
    <section id="top" ref={sectionRef} className="page-aurora relative overflow-hidden">
      {/* Radial wash for smooth edges behind the copy. */}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_50rem_at_top,color-mix(in_oklab,var(--primary)_8%,var(--background)),var(--background))] opacity-90" />

      {/* On a phone the photo fills the hero and the copy is laid over its
          foot, white on a navy scrim. Side by side (a wide screen, or a phone
          on its side), the photo fills the right and the copy sits over its
          faded left edge. */}
      <div className="relative flex min-h-[max(100svh,46rem)] flex-col justify-end pt-(--site-bar-h) split:min-h-[clamp(min(38rem,100svh),calc(100svh-4.75rem),56rem)] split:justify-center">
        <HeroPhoto runId={runId} doodles={split === true} />
        <div aria-hidden className="hero-scrim pointer-events-none absolute inset-0 split:hidden" />

        <div className="relative z-20 mx-auto w-full max-w-7xl px-5 pb-10 sm:px-6 split:py-10 short:py-4">
          <div className="max-w-xl split:max-w-[26rem] xl:max-w-[30rem]">
            <span className="sticker stamp-in">
              <Sparkles className="size-3.5 text-[color:var(--pop-ink)]" aria-hidden /> Modern
              science platform for KS3 &amp; GCSE
            </span>

            {/* The highlighter goes on the one word the whole page is about. A
                second marker anywhere on this screen and neither would land. */}
            <h1 className="font-display split:text-foreground mt-5 text-4xl leading-[1.08] font-extrabold tracking-tight text-white sm:text-5xl xl:text-6xl short:mt-3 short:text-4xl">
              Better grades in <span className="marker">science</span>, taught live by teachers who
              care.
            </h1>

            <div className="mt-7 flex flex-wrap gap-3 sm:gap-4 short:mt-4">
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
          </div>
        </div>
      </div>

      {/* Social proof + trust ticks, full width so the strip runs edge to edge. */}
      <TrustMarquee />
    </section>
  );
}
