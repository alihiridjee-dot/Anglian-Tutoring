import { Link } from "@tanstack/react-router";
import { GraduationCap, ArrowLeft, Check, Sparkles, Stethoscope } from "lucide-react";

/** The wordmark lockup used at the top of every signed-out screen. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2.5 group ${className}`}>
      <span
        className="w-10 h-10 rounded-xl flex items-center justify-center text-primary-foreground shadow-sm"
        style={{ background: "var(--gradient-hero)" }}
      >
        <GraduationCap className="w-5 h-5" />
      </span>
      <span className="font-display text-lg font-semibold tracking-tight group-hover:opacity-80 transition">
        Anglia Educate
      </span>
    </Link>
  );
}

const POINTS = [
  "Your exam board's spec, point by point",
  "Weekly quizzes that target your weak spots",
  "Live sessions and homework in one place",
];

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
        <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm">
          <Sparkles className="w-3.5 h-3.5" /> GCSE & A-Level science
        </span>
        <h2 className="mt-7 font-display text-3xl font-bold leading-[1.2] tracking-tight">
          Everything you need for exam day, in one calm place.
        </h2>
        <ul className="mt-7 space-y-3.5">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-3 text-sm text-white/90">
              <span className="mt-0.5 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <Check className="w-3 h-3" />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative mt-10 flex items-center gap-2.5 rounded-2xl bg-white/10 px-4 py-3 text-sm backdrop-blur-sm">
        <Stethoscope className="w-4 h-4 shrink-0" />
        <span className="text-white/90">
          Taught by practising NHS doctors and qualified teachers.
        </span>
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
    <div className="auth-aurora min-h-screen px-4 py-8 sm:py-12">
      <div className={`w-full ${maxWidth} mx-auto`}>
        <div className="flex items-center justify-between mb-8 sm:mb-10">
          <BrandMark />
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft className="w-4 h-4" /> Back to home
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
