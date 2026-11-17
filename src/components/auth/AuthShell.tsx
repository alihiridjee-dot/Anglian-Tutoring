import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import { GraduationCap, ArrowLeft, ListChecks, Stethoscope, Target, Video } from "lucide-react";

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

const HEADLINE = "Everything you need for exam day, in one calm place";
const HEADLINE_WORDS = HEADLINE.split(" ");
/** "one calm place." carries the point, so it gets the underline. */
const CALM_FROM = HEADLINE_WORDS.length - 3;

const POINTS = [
  { text: "Your exam board's spec, point by point", icon: ListChecks, tint: "tint-accent" },
  { text: "Weekly quizzes that target your weak spots", icon: Target, tint: "tint-amber" },
  { text: "Live sessions and tasks in one place", icon: Video, tint: "tint-rose" },
  {
    text: "Taught by practising NHS doctors and qualified teachers",
    icon: Stethoscope,
    tint: "tint-primary",
  },
];

/* The delivery, in seconds from load: the owl peeks over the form, the
   headline rises in word by word, the underline draws under its last three
   words, the points land one at a time, and the owl cheers. */
const OWL_AT = 0.2;
const WORDS_AT = 0.3;
const WORD_STEP = 0.07;
const UNDERLINE_AT = 1.2;
const POINTS_AT = 1.35;
const POINT_STEP = 0.15;
const CHEER_AT = POINTS_AT + POINTS.length * POINT_STEP + 0.3;

const delay = (name: string, s: number) => ({ [name]: `${s}s` }) as React.CSSProperties;

/** The owl's arrival and cheer, for wherever it is placed. */
export const OWL_HOST_STYLE = {
  ...delay("--peek-delay", OWL_AT),
  ...delay("--cheer-delay", CHEER_AT),
};

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
export function ShyOwl({
  size = 72,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
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

    // The owl sits on the form now, so it watches the whole page's entrances.
    const pane = document;
    setShy(isPassword(document.activeElement));
    if (follow) {
      window.addEventListener("pointermove", onMove, { passive: true });
      pane.addEventListener("animationstart", onEntrance);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      pane.removeEventListener("animationstart", onEntrance);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <span ref={ref} className={cn("shrink-0", className)} style={style}>
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
      className="pointer-events-none absolute -top-40 -right-6 w-[22rem] text-primary opacity-[0.14]"
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
 * Playful minimalism: no box of its own. The headline and the points sit on
 * the page, each point a bare row behind a solid dot of its own tint, and the
 * fun is in how they arrive (see the timings above), not in more surfaces.
 */
export function BrandPanel() {
  return (
    <aside className="relative hidden lg:flex flex-col justify-center py-6">
      <OrbitArt />
      <div className="relative">
        <h2 aria-label={HEADLINE} className="text-[2.6rem] leading-[1.08] font-extrabold">
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
                className="squiggle-draw absolute -bottom-3 left-0 h-3.5 text-[color:var(--pop)]"
                style={delay("--squiggle-delay", UNDERLINE_AT)}
              />
            </span>
          </span>
        </h2>
        <ul className="mt-11 space-y-5">
          {POINTS.map((p, i) => (
            <li
              key={p.text}
              data-owl-watch
              className={cn(
                "auth-point point-in flex items-center gap-4 text-lg leading-snug font-bold",
                p.tint,
              )}
              style={delay("--point-delay", POINTS_AT + i * POINT_STEP)}
            >
              <span
                className="auth-dot icon-tile icon-tile-solid pop-in size-11 shrink-0 justify-center rounded-full"
                style={delay("--pop-delay", POINTS_AT + i * POINT_STEP + 0.12)}
              >
                <p.icon className="size-5" aria-hidden />
              </span>
              {p.text}
            </li>
          ))}
        </ul>
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
