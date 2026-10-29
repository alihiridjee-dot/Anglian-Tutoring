import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  GraduationCap,
  ArrowLeft,
  ListChecks,
  Sparkles,
  Stethoscope,
  Target,
  Video,
} from "lucide-react";

import { Mascot, Squiggle } from "@/components/Doodles";
import { cn } from "@/lib/utils";

/** The wordmark lockup used at the top of every signed-out screen. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`wordmark inline-flex items-center gap-2.5 ${className}`}>
      <span className="icon-tile icon-tile-solid wordmark-tile size-10 shrink-0">
        <GraduationCap className="size-5" aria-hidden />
      </span>
      <span className="font-display text-[0.95rem] leading-tight font-extrabold">
        Anglia
        <span className="text-muted-foreground block text-[0.7rem] font-bold tracking-[0.18em] uppercase">
          Educate
        </span>
      </span>
    </Link>
  );
}

const HEADLINE = "Everything you need for exam day, in one calm place.";
const HEADLINE_WORDS = HEADLINE.split(" ");
/** "one calm place." carries the point, so it gets the underline. */
const CALM_FROM = HEADLINE_WORDS.length - 3;

const POINTS = [
  { text: "Your exam board's spec, point by point", icon: ListChecks, tint: "tint-accent" },
  { text: "Weekly quizzes that target your weak spots", icon: Target, tint: "tint-amber" },
  { text: "Live sessions and tasks in one place", icon: Video, tint: "tint-rose" },
];

/* The delivery, in seconds from load: the owl peeks up, the headline rises in
   word by word, the underline draws under its last three words, the points
   land one at a time, and the owl says the trust line. */
const OWL_AT = 0.2;
const WORDS_AT = 0.3;
const WORD_STEP = 0.07;
const UNDERLINE_AT = 1.2;
const POINTS_AT = 1.35;
const POINT_STEP = 0.15;
const BUBBLE_AT = 2.05;

const delay = (name: string, s: number) => ({ [name]: `${s}s` }) as React.CSSProperties;

/** One headline word, rising into place on its turn. */
function RisingWord({ word, index }: { word: string; index: number }) {
  return (
    <span
      data-owl-watch
      className="word-rise"
      style={delay("--word-delay", WORDS_AT + index * WORD_STEP)}
    >
      {word}
    </span>
  );
}

const isPassword = (t: EventTarget | null) =>
  t instanceof HTMLInputElement && t.type === "password";

/**
 * The panel's owl keeps an eye on the form: its eyes follow the pointer, or
 * the field that has focus, and it covers them with its wings while someone
 * types a password. While the panel delivers its text it reads along: every
 * entrance marked `data-owl-watch` turns its eyes as it starts. The eyes move
 * through CSS variables written straight onto the wrapper, so none of this
 * ever re-renders anything.
 */
function ShyOwl({ size = 72, className }: { size?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shy, setShy] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const follow = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const lookAt = (x: number, y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const dx = x - (r.left + r.width / 2);
        const dy = y - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        // Full reach from ~150px away, so a pointer over the owl doesn't
        // make it go cross-eyed.
        const reach = Math.min(1, d / 150);
        el.style.setProperty("--gaze-x", `${(dx / d) * 3.5 * reach}px`);
        el.style.setProperty("--gaze-y", `${(dy / d) * 2.5 * reach}px`);
      });
    };
    const lookAtEl = (t: Element) => {
      const r = t.getBoundingClientRect();
      lookAt(r.left + r.width / 2, r.top + r.height / 2);
    };
    const onMove = (e: PointerEvent) => lookAt(e.clientX, e.clientY);
    const onEntrance = (e: AnimationEvent) => {
      if (e.target instanceof HTMLElement && e.target.dataset.owlWatch !== undefined) {
        lookAtEl(e.target);
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      setShy(isPassword(e.target));
      if (follow && e.target instanceof HTMLElement) lookAtEl(e.target);
    };
    const onFocusOut = (e: FocusEvent) => setShy(isPassword(e.relatedTarget));

    const pane = el.closest("aside");
    setShy(isPassword(document.activeElement));
    if (follow) {
      window.addEventListener("pointermove", onMove, { passive: true });
      pane?.addEventListener("animationstart", onEntrance);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      pane?.removeEventListener("animationstart", onEntrance);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <span ref={ref} className={cn("shrink-0", className)}>
      <Mascot
        name="owl"
        mood="happy"
        size={size}
        hideEyes={shy}
        /* A mascot draws its outlines from `currentColor` and fills from its
           tint, which is pale — so on a dark panel it needs a DARK stroke to
           have any definition. White-on-white here was a shapeless blob. */
        className="text-[color:var(--primary-deep)]"
      />
    </span>
  );
}

/** One orbit of the backdrop atom, drawn about the origin. */
const ORBIT = "M-150 0a150 54 0 1 0 300 0a150 54 0 1 0-300 0";

/**
 * A line-drawn atom behind the headline: three orbits draw themselves on, then
 * the nucleus and an electron per orbit light up. Drawn once on arrival, then
 * still — the owl is the panel's only idle motion.
 */
function OrbitArt() {
  return (
    <svg
      aria-hidden
      viewBox="-170 -170 340 340"
      className="pointer-events-none absolute -top-28 -right-32 w-[30rem] opacity-[0.22]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      {[0, 60, 120].map((deg, i) => (
        <g key={deg} transform={`rotate(${deg})`}>
          <path
            d={ORBIT}
            pathLength={1}
            className="orbit-draw"
            style={delay("--orbit-delay", 0.1 + i * 0.22)}
          />
          <circle
            cx={i === 1 ? -106 : 150}
            cy={i === 1 ? 38 : 0}
            r={5}
            fill="currentColor"
            stroke="none"
            className="glitter-dot"
            style={delay("--glitter-delay", 1.1 + i * 0.15)}
          />
        </g>
      ))}
      <circle
        r={12}
        fill="currentColor"
        stroke="none"
        className="glitter-dot"
        style={delay("--glitter-delay", 0.9)}
      />
    </svg>
  );
}

/**
 * Marketing panel beside the auth form on desktop. Hidden below lg — on a phone
 * the form is the whole point of the screen and this would just push it down.
 *
 * It delivers its text rather than just showing it: see the timings above.
 */
export function BrandPanel() {
  return (
    <aside className="hidden lg:flex flex-col justify-between rounded-3xl p-9 text-primary-foreground relative overflow-hidden rise-in">
      {/* Brand gradient lit from two corners: daylight top left, a teal glow
          rising behind the points, and a warm pool of light where the owl sits. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(22rem 16rem at -5% -8%, color-mix(in oklab, white 24%, transparent), transparent 70%)",
            "radial-gradient(28rem 22rem at 105% 75%, color-mix(in oklab, var(--accent) 55%, transparent), transparent 70%)",
            "radial-gradient(16rem 12rem at 8% 100%, color-mix(in oklab, var(--pop) 26%, transparent), transparent 70%)",
            "var(--gradient-hero)",
          ].join(", "),
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            "radial-gradient(currentColor 1px, transparent 1px), radial-gradient(currentColor 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          backgroundPosition: "0 0, 14px 14px",
          maskImage: "linear-gradient(to bottom, black, transparent 85%)",
        }}
      />
      <OrbitArt />

      <div className="relative">
        <span
          className="pop-in inline-flex items-center gap-2 rounded-full border-[1.5px] border-white/30 bg-white/15 px-3 py-1.5 text-xs font-extrabold shadow-[0_2px_0_0_rgba(0,0,0,0.15)] backdrop-blur-sm"
          style={delay("--pop-delay", 0.15)}
        >
          <Sparkles className="size-3.5" aria-hidden /> GCSE &amp; A-Level science
        </span>
        <h2
          aria-label={HEADLINE}
          className="mt-7 text-[2.35rem] leading-[1.08] font-extrabold tracking-tight"
        >
          <span aria-hidden>
            {HEADLINE_WORDS.slice(0, CALM_FROM).map((w, i) => (
              <Fragment key={i}>
                <RisingWord word={w} index={i} />{" "}
              </Fragment>
            ))}
            <span className="relative inline-block whitespace-nowrap">
              {HEADLINE_WORDS.slice(CALM_FROM).map((w, i) => (
                <Fragment key={i}>
                  {i > 0 ? " " : null}
                  <RisingWord word={w} index={CALM_FROM + i} />
                </Fragment>
              ))}
              <Squiggle
                className="squiggle-draw absolute -bottom-2.5 left-0 h-3 text-[color:var(--pop)]"
                style={delay("--squiggle-delay", UNDERLINE_AT)}
              />
            </span>
          </span>
        </h2>
        <ul className="mt-8 space-y-3">
          {POINTS.map((p, i) => (
            <li
              key={p.text}
              data-owl-watch
              className={cn(
                "premium-card point-in flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold text-foreground",
                p.tint,
              )}
              style={delay("--point-delay", POINTS_AT + i * POINT_STEP)}
            >
              <span className="icon-tile size-10 shrink-0">
                <p.icon className="size-5" aria-hidden />
              </span>
              {p.text}
            </li>
          ))}
        </ul>
      </div>

      {/* The owl hosts the panel: it rises up first, reads along as the text
          arrives, then says the trust line itself — the last thing someone
          reads before signing up, and worth more in a voice than as a bullet. */}
      <div
        className="relative mt-10 flex items-end gap-2"
        style={{ ...delay("--peek-delay", OWL_AT), ...delay("--cheer-delay", BUBBLE_AT + 0.1) }}
      >
        <ShyOwl size={132} className="owl-host -mb-4 -ml-3" />
        <p
          data-owl-watch
          className="premium-card bubble-in mb-12 flex items-center gap-2.5 rounded-2xl rounded-bl-sm px-4 py-3 text-sm font-semibold text-foreground"
          style={delay("--bubble-delay", BUBBLE_AT)}
        >
          <span className="icon-tile size-9 shrink-0">
            <Stethoscope className="size-4" aria-hidden />
          </span>
          Taught by practising NHS doctors and qualified teachers.
        </p>
      </div>
    </aside>
  );
}

/** Page frame: aurora backdrop, back-to-home link and the wordmark. */
export function AuthShell({
  children,
  maxWidth = "max-w-5xl",
}: {
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    // Less air above the card on a phone turned sideways, where 390px has to
    // hold the brand row and as much of the form as it can.
    <div className="auth-aurora min-h-screen px-4 py-8 sm:py-12 short:py-4">
      <div className={`w-full ${maxWidth} mx-auto`}>
        <div className="flex items-center justify-between mb-8 sm:mb-10 short:mb-4">
          <BrandMark />
          <Link
            to="/"
            className="btn-ghost inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 py-2 text-sm sm:pointer-fine:min-h-0"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back to home
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
