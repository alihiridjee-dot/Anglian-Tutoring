import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { GraduationCap, ArrowLeft, Check, Sparkles, Stethoscope } from "lucide-react";

import { Mascot } from "@/components/Doodles";

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

const POINTS = [
  "Your exam board's spec, point by point",
  "Weekly quizzes that target your weak spots",
  "Live sessions and tasks in one place",
];

const isPassword = (t: EventTarget | null) =>
  t instanceof HTMLInputElement && t.type === "password";

/**
 * The panel's owl keeps an eye on the form: its eyes follow the pointer, or
 * the field that has focus, and it covers them with its wings while someone
 * types a password. The eyes move through CSS variables written straight onto
 * the wrapper, so following the mouse never re-renders anything.
 */
function ShyOwl() {
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
    const onMove = (e: PointerEvent) => lookAt(e.clientX, e.clientY);
    const onFocusIn = (e: FocusEvent) => {
      setShy(isPassword(e.target));
      if (follow && e.target instanceof HTMLElement) {
        const r = e.target.getBoundingClientRect();
        lookAt(r.left + r.width / 2, r.top + r.height / 2);
      }
    };
    const onFocusOut = (e: FocusEvent) => setShy(isPassword(e.relatedTarget));

    setShy(isPassword(document.activeElement));
    if (follow) window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <span ref={ref} className="shrink-0">
      <Mascot
        name="owl"
        mood="happy"
        size={72}
        hideEyes={shy}
        /* A mascot draws its outlines from `currentColor` and fills from its
           tint, which is pale — so on a dark panel it needs a DARK stroke to
           have any definition. White-on-white here was a shapeless blob. */
        className="text-[color:var(--primary-deep)]"
      />
    </span>
  );
}

/**
 * Marketing panel beside the auth form on desktop. Hidden below lg — on a phone
 * the form is the whole point of the screen and this would just push it down.
 */
export function BrandPanel() {
  return (
    <aside className="hidden lg:flex flex-col justify-between rounded-3xl p-9 text-primary-foreground relative overflow-hidden rise-in">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "var(--gradient-hero)" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            "radial-gradient(currentColor 1px, transparent 1px), radial-gradient(currentColor 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          backgroundPosition: "0 0, 14px 14px",
        }}
      />
      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-white/30 bg-white/15 px-3 py-1.5 text-xs font-extrabold shadow-[0_2px_0_0_rgba(0,0,0,0.15)] backdrop-blur-sm">
          <Sparkles className="size-3.5" aria-hidden /> GCSE &amp; A-Level science
        </span>
        <h2 className="font-display mt-7 text-3xl leading-[1.15] font-extrabold tracking-tight">
          Everything you need for exam day, in one calm place.
        </h2>
        <ul className="mt-7 space-y-3.5">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-3 text-sm text-white/90">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/20">
                <Check className="size-3" aria-hidden />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative mt-10 flex items-center gap-3">
        {/* One character, peeking over the trust note — the panel is the last
            thing someone reads before signing up, and a face here is worth
            more than a fourth bullet. */}
        <ShyOwl />
        <div className="flex items-center gap-2.5 rounded-2xl border-[1.5px] border-white/20 bg-white/10 px-4 py-3 text-sm backdrop-blur-sm">
          <Stethoscope className="size-4 shrink-0" aria-hidden />
          <span className="text-white/90">
            Taught by practising NHS doctors and qualified teachers.
          </span>
        </div>
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
