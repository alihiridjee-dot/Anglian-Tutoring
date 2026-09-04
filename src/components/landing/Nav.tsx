import { Link } from "@tanstack/react-router";
import { GraduationCap, Sparkles } from "lucide-react";

/**
 * The wordmark: a chunky monogram tile plus the name.
 *
 * The tile squashes and stretches on hover of the whole mark (`.wordmark-tile`,
 * see styles.css). It is silent until someone reaches for it, which is what
 * keeps the personality from becoming noise on a page you read every day.
 */
export function Wordmark() {
  return (
    <span className="wordmark inline-flex items-center gap-2.5">
      <span className="icon-tile icon-tile-solid wordmark-tile size-10 shrink-0">
        <GraduationCap className="size-5" aria-hidden />
      </span>
      <span className="font-display text-[0.95rem] leading-tight font-extrabold">
        Anglia
        <span className="text-muted-foreground block text-[0.7rem] font-bold tracking-[0.18em] uppercase">
          Educate
        </span>
      </span>
    </span>
  );
}

/**
 * Section links underline with the highlighter on hover rather than a rule —
 * the same yellow that marks the one word in the hero, so the nav belongs to
 * the same drawing.
 */
const NAV_LINK =
  "relative font-semibold transition hover:text-foreground after:absolute after:-bottom-1 after:left-0 after:h-[3px] after:w-0 after:rounded-full after:bg-[color:var(--pop)] after:transition-[width] hover:after:w-full";

export function Nav() {
  return (
    <header className="glass-bar sticky top-0 z-40">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-6">
        <Link to="/" hash="top">
          <Wordmark />
        </Link>

        {/* Section links route back to the landing page by path + hash, so they
            work from standalone pages (e.g. /how-it-works) as well as from "/". */}
        <nav className="text-muted-foreground hidden items-center gap-7 text-sm md:flex">
          <Link to="/" hash="tutors" className={NAV_LINK}>
            Our Tutors
          </Link>
          <Link
            to="/how-it-works"
            className={NAV_LINK}
            activeProps={{ className: "text-foreground" }}
          >
            How it works
          </Link>
          <Link to="/" hash="offer" className={NAV_LINK}>
            What we offer
          </Link>
          <Link to="/" hash="pricing" className={NAV_LINK}>
            Pricing
          </Link>
          <Link to="/" hash="contact" className={NAV_LINK}>
            Contact
          </Link>
        </nav>

        <div className="flex items-center gap-2.5">
          <Link
            to="/demo"
            className="btn-soft inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm"
          >
            <Sparkles className="size-3.5 text-[color:var(--pop-ink)]" aria-hidden />
            <span className="hidden sm:inline">Demo Platform</span>
            <span className="sm:hidden">Demo</span>
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signin" } as never}
            className="btn-ghost rounded-xl px-3 py-2 text-sm"
          >
            Login
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" } as never}
            className="btn-hero rounded-xl px-4 py-2 text-sm"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
