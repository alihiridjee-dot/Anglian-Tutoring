import { Link, useRouterState } from "@tanstack/react-router";
import { GraduationCap, Menu, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

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
  "relative whitespace-nowrap font-semibold transition hover:text-foreground after:absolute after:-bottom-1 after:left-0 after:h-[3px] after:w-0 after:rounded-full after:bg-[color:var(--pop)] after:transition-[width] hover:after:w-full";

/** The phone sheet's rows: full-width, 44px tall, in the kit's ghost chassis. */
const SHEET_LINK = "btn-ghost flex min-h-11 items-center rounded-xl px-3 py-2.5 text-base";

export function Nav() {
  // Below `md` the section links live in a sheet under the bar. It closes on
  // the backdrop, Escape, a link, or any navigation.
  const [open, setOpen] = useState(false);
  const location = useRouterState({ select: (s) => s.location.href });

  useEffect(() => {
    setOpen(false);
  }, [location]);

  useBodyScrollLock(open);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="glass-bar sticky top-0 z-40 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-3 sm:px-6">
        <Link to="/" hash="top" className="shrink-0">
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
          <Link to="/our-story" className={NAV_LINK} activeProps={{ className: "text-foreground" }}>
            Our story
          </Link>
          <Link to="/" hash="pricing" className={NAV_LINK}>
            Pricing
          </Link>
          <Link to="/" hash="contact" className={NAV_LINK}>
            Contact
          </Link>
        </nav>

        {/* Sized to fit a 360px phone beside the wordmark: tighter gutters on
            the two buttons, and the menu button borrows the bar's own padding
            (it has no fill, so nothing looks off-centre). */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <Link
            to="/demo"
            className="btn-soft inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm sm:min-h-0 sm:px-3.5"
          >
            <Sparkles className="size-3.5 text-[color:var(--pop-ink)]" aria-hidden />
            <span className="hidden sm:inline">Demo Platform</span>
            <span className="sm:hidden">Demo</span>
          </Link>
          {/* Login moves into the sheet on a phone: the bar has room for the
              wordmark, Demo, Sign up and the menu button, not a fifth item. */}
          <Link
            to="/auth"
            search={{ mode: "signin" } as never}
            className="btn-ghost hidden rounded-xl px-3 py-2 text-sm sm:inline-flex"
          >
            Login
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" } as never}
            className="btn-hero inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-3 py-2 text-sm sm:min-h-0 sm:px-4"
          >
            Sign up
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            className="btn-ghost -mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl md:hidden"
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {/* The phone sheet. `backdrop-filter` on the bar makes it the containing
          block for fixed descendants, so both layers are positioned from the bar
          itself: the scrim fills the viewport below it, the sheet hangs off it. */}
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="bg-primary-deep/40 absolute inset-x-0 top-full h-dvh cursor-pointer md:hidden"
          />
          <nav
            id="site-menu"
            aria-label="Site"
            className="bg-background absolute inset-x-0 top-full max-h-[calc(100dvh-4.5rem)] overflow-y-auto border-b-[1.5px] border-[color:color-mix(in_oklab,var(--foreground)_9%,transparent)] px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl md:hidden"
          >
            <ul className="flex flex-col gap-0.5">
              <li>
                <Link to="/" hash="tutors" className={SHEET_LINK}>
                  Our Tutors
                </Link>
              </li>
              <li>
                <Link
                  to="/how-it-works"
                  className={SHEET_LINK}
                  activeProps={{ className: "text-foreground" }}
                >
                  How it works
                </Link>
              </li>
              <li>
                <Link
                  to="/our-story"
                  className={SHEET_LINK}
                  activeProps={{ className: "text-foreground" }}
                >
                  Our story
                </Link>
              </li>
              <li>
                <Link to="/" hash="pricing" className={SHEET_LINK}>
                  Pricing
                </Link>
              </li>
              <li>
                <Link to="/" hash="contact" className={SHEET_LINK}>
                  Contact
                </Link>
              </li>
            </ul>
            <div className="rule-dashed mt-2 pt-2 sm:hidden">
              <Link to="/auth" search={{ mode: "signin" } as never} className={SHEET_LINK}>
                Login
              </Link>
            </div>
          </nav>
        </>
      )}
    </header>
  );
}
