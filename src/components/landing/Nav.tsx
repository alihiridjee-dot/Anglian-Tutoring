import { Link, useRouterState } from "@tanstack/react-router";
import { GraduationCap, Menu, Sparkles, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { cn } from "@/lib/utils";

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
 * Section links sit together in the kit's tab row, so the page you are on is
 * the raised tab. They still underline with the highlighter on hover — the
 * same yellow that marks the one word in the hero, so the nav belongs to the
 * same drawing. The underline spans the label, inside the tab's own padding.
 */
const NAV_LINK =
  "tab-item relative inline-flex items-center after:absolute after:inset-x-[0.85rem] after:bottom-1 after:h-[3px] after:origin-left after:scale-x-0 after:rounded-full after:bg-[color:var(--pop)] after:transition-transform hover:after:scale-x-100";

/**
 * A section of the landing page is the current tab only while the address
 * names it. Without this every `/#…` link counts as current on `/`.
 */
const SECTION_ACTIVE = { includeHash: true } as const;

/**
 * A tab's label, over the raised pill when it is the current tab. There is one
 * pill (`layoutId`), and it glides from tab to tab, across a page change too,
 * rather than each tab lighting up on its own — as in the kit's
 * `SegmentedToggle`, whose spring this borrows.
 */
function tabLabel(label: string, reduceMotion: boolean | null) {
  return ({ isActive }: { isActive: boolean }) => (
    <>
      {isActive && (
        <motion.span
          layoutId="site-nav-pill"
          className="tab-pill absolute inset-0"
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }
          }
        />
      )}
      <span className="relative">{label}</span>
    </>
  );
}

/** The phone sheet's rows: full-width, 44px tall, in the kit's ghost chassis. */
const SHEET_LINK = "btn-ghost flex min-h-11 items-center rounded-xl px-3 py-2.5 text-base";

export function Nav() {
  // Below `lg` the section links live in a sheet under the bar. It closes on
  // the backdrop, Escape, a link, or any navigation. The bar needs about 945px
  // for all five links beside the buttons, so `md` would push Sign up off a
  // phone turned sideways and off a portrait iPad.
  const [open, setOpen] = useState(false);
  const location = useRouterState({ select: (s) => s.location.href });
  const reduceMotion = useReducedMotion();

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

  // Clear over the hero; glass once the page has moved, or while the sheet is
  // open, so the bar never floats loose over the sheet's scrim.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "site-bar sticky top-0 z-40 pt-[env(safe-area-inset-top)]",
        (scrolled || open) && "glass-bar",
      )}
    >
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-3 sm:px-6">
        <Link to="/" hash="top" className="shrink-0">
          <Wordmark />
        </Link>

        {/* Section links route back to the landing page by path + hash, so they
            work from standalone pages (e.g. /how-it-works) as well as from "/". */}
        <nav className="tab-row hidden items-center lg:flex">
          <Link to="/" hash="tutors" activeOptions={SECTION_ACTIVE} className={NAV_LINK}>
            {tabLabel("Our Tutors", reduceMotion)}
          </Link>
          <Link to="/how-it-works" className={NAV_LINK}>
            {tabLabel("How it works", reduceMotion)}
          </Link>
          <Link to="/our-story" className={NAV_LINK}>
            {tabLabel("Our story", reduceMotion)}
          </Link>
          <Link to="/" hash="pricing" activeOptions={SECTION_ACTIVE} className={NAV_LINK}>
            {tabLabel("Pricing", reduceMotion)}
          </Link>
          <Link to="/" hash="contact" activeOptions={SECTION_ACTIVE} className={NAV_LINK}>
            {tabLabel("Contact", reduceMotion)}
          </Link>
        </nav>

        {/* Sized to fit a 360px phone beside the wordmark: tighter gutters on
            the two buttons, and the menu button borrows the bar's own padding
            (it has no fill, so nothing looks off-centre). */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <Link
            to="/demo"
            className="btn-soft inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm sm:pointer-fine:min-h-0 sm:px-3.5"
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
            className="btn-ghost hidden min-h-11 items-center rounded-xl px-3 py-2 text-sm sm:inline-flex sm:pointer-fine:min-h-0"
          >
            Login
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" } as never}
            className="btn-hero inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-3 py-2 text-sm sm:pointer-fine:min-h-0 sm:px-4"
          >
            Sign up
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            className="btn-ghost -mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl lg:hidden"
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
            className="bg-primary-deep/40 absolute inset-x-0 top-full h-dvh cursor-pointer lg:hidden"
          />
          <nav
            id="site-menu"
            aria-label="Site"
            className="bg-background absolute inset-x-0 top-full max-h-[calc(100dvh-4.5rem)] overflow-y-auto border-b-[1.5px] border-[color:color-mix(in_oklab,var(--foreground)_9%,transparent)] px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl lg:hidden"
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
