import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Star, Stethoscope, GraduationCap, BookOpen } from "lucide-react";

import { Mascot } from "@/components/Doodles";

// The hero photo: a student holding up a conical flask in a school lab. From
// Pexels (pexels.com/photo/37951908, uploaded by Poddar Group of Institutions),
// free to use with no credit required. It is served from /public, cropped to
// exactly 16:9, so it can't vanish at its source the way the last hero photo
// did. Every coordinate below is in its 1600 × 900 frame, which is how the
// drawings stay on her head and her flask however the photo is cropped.
const PHOTO_WIDTHS = [960, 1600, 2400];

// Sparkles that twinkle round the cap and the flask once they have landed.
// Hand-placed (not Math.random) so the server and client render the same dots,
// otherwise React throws a hydration mismatch on this SSR'd page.
const GLITTER: { x: number; y: number; r: number; delay: number }[] = [
  { x: 752, y: 168, r: 9, delay: 0 },
  { x: 1128, y: 142, r: 7, delay: 1.2 },
  { x: 1214, y: 292, r: 8, delay: 2.1 },
  { x: 868, y: 112, r: 6, delay: 0.6 },
  { x: 1046, y: 96, r: 5, delay: 1.8 },
  { x: 606, y: 352, r: 8, delay: 0.9 },
  { x: 818, y: 520, r: 7, delay: 2.6 },
  { x: 640, y: 266, r: 5, delay: 1.5 },
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
// on her head. It builds the way a real one goes on, each piece starting close
// to where it ends up: the crown, then the board drops onto it (a ring flashes
// out as it lands), then the tassel swings down from the button. About 1.3 s.
const CAP_RIBBONS: Ribbon[] = [
  // The crown, round the top of her head. First, so the board paints over it.
  {
    d: "M-70,6 L-66,56 C-30,68 30,68 66,56 L70,6",
    width: 3.5,
    delay: 0,
    dur: 0.5,
    from: { x: "0px", y: "14px", scale: 1.06 },
    fill: "url(#cap-crown)",
  },
  // The board.
  {
    d: CAP_BOARD,
    width: 4.5,
    delay: 0.3,
    dur: 0.5,
    from: { x: "0px", y: "-30px", scale: 1.1 },
    fill: "url(#cap-board)",
    land: true,
  },
  {
    d: CAP_BOARD,
    width: 3,
    delay: 0.66,
    from: { x: "0px", y: "0px", scale: 1 },
    pulse: true,
  },
  // Tassel: swings down from the button.
  {
    d: "M0,-10 C0,20 96,4 128,44 C138,58 138,74 130,90",
    width: 3.5,
    delay: 0.85,
    dur: 0.45,
    from: { x: "12px", y: "-8px", scale: 1.04 },
  },
];

// The flask she is holding, traced in the photo's own frame once the cap is
// on. Her fingers are round its neck, so the ribbons stop where they start.
const FLASK_RIBBONS: Ribbon[] = [
  // The body, shoulder to shoulder round the base.
  {
    d: "M672,490 L627,610 Q622,626 638,626 L780,626 Q796,626 791,610 L746,490",
    width: 5,
    delay: 1.1,
    from: { x: "0px", y: "30px", scale: 1.15 },
  },
  // The lip, above her fingers.
  {
    d: "M681,368 L681,352 Q681,348 685,348 L749,348 Q753,348 753,352 L753,368",
    width: 4.5,
    delay: 1.4,
    from: { x: "0px", y: "-24px", scale: 1.2 },
  },
  // Volume marks.
  {
    d: "M659,532 H679 M648,560 H674 M637,588 H657",
    width: 3,
    delay: 1.8,
    from: { x: "-16px", y: "0px", scale: 1 },
  },
  // The top of the liquid.
  {
    d: "M641,584 Q676,576 710,584 T779,584",
    width: 3,
    delay: 2,
    from: { x: "0px", y: "12px", scale: 1 },
    stroke: "var(--accent)",
  },
];

// Bubbles rise through the liquid; fizz pops out of the top of the flask.
const BUBBLES: { x: number; y: number; r: number; delay: number }[] = [
  { x: 690, y: 616, r: 5, delay: 0 },
  { x: 726, y: 620, r: 4, delay: 0.8 },
  { x: 752, y: 612, r: 6, delay: 1.5 },
  { x: 706, y: 604, r: 3.5, delay: 2.1 },
];
const FIZZ: { x: number; y: number; r: number; delay: number; drift: string }[] = [
  { x: 708, y: 334, r: 5, delay: 0.3, drift: "-14px" },
  { x: 734, y: 328, r: 4, delay: 1.1, drift: "10px" },
  { x: 720, y: 338, r: 3, delay: 1.9, drift: "-4px" },
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
 * Blue ribbons build a graduation cap on her head, piece by piece, each piece
 * colouring in as its outline closes.
 */
function GradCapRibbons({ runId }: { runId: number }) {
  return (
    <g transform="translate(933 252) rotate(-6) scale(1.75 1.45)">
      <Ribbons ribbons={CAP_RIBBONS} runId={runId} stroke="url(#cap-ribbon)" />

      {/* Board button and tassel bead, fading in once their ribbons land. */}
      <circle
        key={`${runId}-button`}
        cx="0"
        cy="-10"
        r="5"
        fill="var(--accent)"
        className="glitter-dot"
        style={{ "--glitter-delay": "0.8s" } as React.CSSProperties}
      />
      <circle
        key={`${runId}-bead`}
        cx="130"
        cy="96"
        r="6.5"
        fill="var(--primary)"
        className="glitter-dot"
        style={{ "--glitter-delay": "1.15s" } as React.CSSProperties}
      />
    </g>
  );
}

/**
 * The flask she is holding is built over in the same ribbons, then fizzes:
 * bubbles rise through the liquid and pop out of the top.
 */
function FlaskRibbons({ runId }: { runId: number }) {
  return (
    <g>
      <Ribbons ribbons={FLASK_RIBBONS} runId={runId} stroke="url(#flask-ribbon)" />
      {BUBBLES.map((b, i) => (
        <circle
          key={`${runId}-bubble-${i}`}
          cx={b.x}
          cy={b.y}
          r={b.r}
          fill="white"
          fillOpacity="0.55"
          stroke="var(--accent)"
          strokeWidth="1.5"
          className="flask-bubble"
          style={{ "--bubble-delay": `${2.4 + b.delay}s` } as React.CSSProperties}
        />
      ))}
      {FIZZ.map((f, i) => (
        <circle
          key={`${runId}-fizz-${i}`}
          cx={f.x}
          cy={f.y}
          r={f.r}
          stroke="var(--accent)"
          strokeWidth="2"
          className="flask-fizz"
          style={
            {
              "--bubble-delay": `${2.2 + f.delay}s`,
              "--fizz-x": f.drift,
            } as React.CSSProperties
          }
        />
      ))}
    </g>
  );
}

/**
 * The photo, with the cap and the flask drawn on it. Both share one 16:9
 * stage, sized like `object-fit: cover`, so the drawings move with the photo
 * (see `.hero-photo` in styles.css). The ribbons are decoration (aria-hidden);
 * the photo's alt says what it shows.
 *
 * `runId` remounts the animated nodes to replay the CSS animations from the
 * top — the hero animates on load and again each time it scrolls back into view.
 */
function HeroPhoto({ runId }: { runId: number }) {
  return (
    <div className="hero-photo relative aspect-[16/10] sm:aspect-video lg:absolute lg:inset-0 lg:aspect-auto short:order-last">
      <div className="hero-photo-stage">
        <img
          src="/hero/student-lab-1600.webp"
          srcSet={PHOTO_WIDTHS.map((w) => `/hero/student-lab-${w}.webp ${w}w`).join(", ")}
          sizes="(min-width: 1024px) 100vw, 112vw"
          width={1600}
          height={900}
          alt="A student in a lab coat holding up a flask of purple liquid"
          fetchPriority="high"
          draggable={false}
          className="absolute inset-0 size-full select-none"
        />
        <svg
          aria-hidden
          viewBox="0 0 1600 900"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
        >
          <defs>
            {/* Cap strokes run in the cap's own frame, flask strokes in the photo's. */}
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
            <linearGradient
              id="flask-ribbon"
              x1="620"
              y1="0"
              x2="800"
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
          <FlaskRibbons runId={runId} />

          {GLITTER.map((g, i) => (
            <circle
              key={`${runId}-glint-${i}`}
              cx={g.x}
              cy={g.y}
              r={g.r}
              fill="url(#glint)"
              className="glitter-dot"
              style={{ "--glitter-delay": `${1.3 + g.delay * 0.25}s` } as React.CSSProperties}
            >
              <animate
                attributeName="opacity"
                values="0.2;1;0.2"
                dur="3s"
                begin={`${2 + g.delay}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </svg>
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

      {/* On a wide screen the photo fills the hero and the copy sits over its
          faded left edge. Narrower, the photo comes first with the copy under
          it — except on a phone turned sideways, where the copy comes first so
          "Get started" makes the first screen rather than the second. */}
      <div className="relative flex flex-col pt-(--site-bar-h) lg:min-h-[clamp(38rem,calc(100svh-4.75rem),56rem)] lg:pt-0">
        <HeroPhoto runId={runId} />

        <div className="relative z-20 mx-auto flex w-full max-w-7xl px-4 pt-8 pb-14 sm:px-6 lg:flex-1 lg:items-center lg:pt-[calc(var(--site-bar-h)+2rem)] lg:pb-20 short:order-first short:pt-5 short:pb-8">
          <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:max-w-[26rem] lg:text-left xl:max-w-[30rem]">
            <span className="sticker stamp-in">
              <Sparkles className="size-3.5 text-[color:var(--pop-ink)]" aria-hidden /> Modern
              science platform for KS3 &amp; GCSE
            </span>

            {/* The highlighter goes on the one word the whole page is about. A
                second marker anywhere on this screen and neither would land. */}
            <h1 className="font-display text-foreground mt-6 text-4xl leading-[1.08] font-extrabold tracking-tight sm:text-5xl xl:text-6xl short:mt-3 short:text-4xl">
              Better grades in <span className="marker">science</span>, taught by teachers who care.
            </h1>

            <p className="text-muted-foreground mt-5 text-lg leading-relaxed short:mt-2 short:text-base">
              Weekly live lessons in Biology, Chemistry, and Physics, aligned to Edexcel, AQA, and
              OCR. Interactive quizzes, marked tasks, and a grade predictor that actually reflects
              your progress.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-4 lg:justify-start short:mt-4">
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
            <div className="peek-in mt-10 flex items-end justify-center gap-2 sm:gap-6 lg:justify-start">
              <Mascot name="cell" mood="happy" size={72} className="sm:size-[92px]" />
              <Mascot name="flask" mood="wink" size={84} className="sm:size-[108px]" />
              <Mascot name="bolt" mood="wow" size={72} className="sm:size-[92px]" />
            </div>
          </div>
        </div>
      </div>

      {/* Social proof + trust ticks, full width so the strip runs edge to edge. */}
      <TrustMarquee />
    </section>
  );
}
