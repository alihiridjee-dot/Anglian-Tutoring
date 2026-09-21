import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { Meter } from "@/components/Shared";
import { readStep, START_EVENT, TOUR_STEPS, writeStep } from "@/lib/demo/tourSteps";

type Box = { x: number; y: number; width: number; height: number };

/**
 * The part of the page actually on screen. `innerWidth` grows with any content
 * that overflows sideways, which would push the card off a phone's edge.
 */
function visibleSize() {
  const vv = window.visualViewport;
  return {
    width: Math.min(document.documentElement.clientWidth, vv?.width ?? Infinity),
    height: vv?.height ?? document.documentElement.clientHeight,
  };
}

/**
 * The showcase's click-through tour.
 *
 * Mounted by AppLayout on every /demo/* page. The step index lives in
 * sessionStorage, because each page renders its own layout: the tour is
 * remounted on every navigation and carries on from where it was.
 *
 * Unlike the per-page "Show me around" guide, this one is not modal. The
 * spotlight lets clicks through, so a visitor can try what a step points at —
 * play the video, answer the quiz — and then press Next.
 */
export function DemoTour() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const card = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(240);

  // Pick the tour up on arrival, and when a button elsewhere on the page starts it.
  useEffect(() => {
    setIndex(readStep());
    const onStart = () => setIndex(readStep());
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, []);

  const step = index === null ? null : TOUR_STEPS[index];
  const onPage = !!step && step.path === pathname;

  const go = useCallback(
    (n: number | null) => {
      if (n === null || n < 0 || n >= TOUR_STEPS.length) {
        writeStep(null);
        setIndex(null);
        return;
      }
      writeStep(n);
      setIndex(n);
      setBox(null);
      if (TOUR_STEPS[n].path !== pathname) router.history.push(TOUR_STEPS[n].path);
    },
    [pathname, router],
  );

  // Find the step's element — it may render a moment after the page does —
  // bring it into view, and follow it as the page scrolls or resizes.
  useEffect(() => {
    setViewport(visibleSize());
    if (!step || !onPage || !step.target) {
      setBox(null);
      return;
    }
    const selector = step.target;
    let el: HTMLElement | null = null;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      setViewport(visibleSize());
      const r = el?.getBoundingClientRect();
      setBox(r && r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null);
    };
    const started = Date.now();
    const poll = window.setInterval(() => {
      el = document.querySelector<HTMLElement>(selector);
      if (el || Date.now() - started > 5000) {
        window.clearInterval(poll);
        if (!el) return;
        // Leave room above the element for the card when both fit on screen;
        // otherwise centre it and let the card take a corner.
        const room = (card.current?.offsetHeight ?? 240) + 40;
        const fits = el.getBoundingClientRect().height + room + 24 <= visibleSize().height;
        el.style.scrollMarginTop = fits ? `${room}px` : "";
        el.scrollIntoView({ block: fits ? "start" : "center", behavior: "smooth" });
        measure();
        observer = new ResizeObserver(measure);
        observer.observe(el);
      }
    }, 100);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(poll);
      observer?.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [step, onPage]);

  useEffect(() => {
    if (card.current) setCardHeight(card.current.offsetHeight);
  }, [index, box, viewport]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && go(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go]);

  if (!step || index === null) return null;

  const last = index === TOUR_STEPS.length - 1;
  const counter = `${index + 1} / ${TOUR_STEPS.length}`;

  // Wandered off the tour's page: a small card to get back, and nothing else.
  if (!onPage) {
    return (
      <div className="tint-primary fixed right-4 bottom-4 z-[60] w-[min(22rem,calc(100vw-2rem))]">
        <div
          className="premium-card flex items-center gap-3 p-3 shadow-xl"
          style={{ background: "var(--card)" }}
        >
          <span className="icon-tile size-9 shrink-0">
            <Compass className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-bold">Tour paused</p>
            <p className="text-muted-foreground truncate text-xs">Next: {step.title}</p>
          </div>
          <button
            type="button"
            onClick={() => router.history.push(step.path)}
            className="btn-solid rounded-lg px-3 py-1.5 text-sm"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={() => go(null)}
            aria-label="End the tour"
            className="btn-ghost rounded-lg p-1.5"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  // Where the card sits: centred with nothing to point at; otherwise in the
  // free space above or below the spotlight, lined up with it, so it never
  // covers what it describes. A target too tall for either gets a corner.
  const width = Math.min(380, viewport.width - 32);
  const gap = 16;
  const alignedLeft = box
    ? Math.max(16, Math.min(box.x + box.width - width, viewport.width - width - 16))
    : 0;
  let style: React.CSSProperties;
  if (!box) {
    style = {
      left: Math.max(16, (viewport.width - width) / 2),
      top: Math.max(16, (viewport.height - cardHeight) / 2),
      width,
    };
  } else if (box.y - 6 >= cardHeight + gap * 2) {
    style = { left: alignedLeft, top: box.y - 6 - gap - cardHeight, width };
  } else if (viewport.height - (box.y + box.height + 6) >= cardHeight + gap * 2) {
    style = { left: alignedLeft, top: box.y + box.height + 6 + gap, width };
  } else if (box.y + box.height / 2 > viewport.height / 2) {
    style = { right: 16, top: 16, width };
  } else {
    style = { right: 16, bottom: 16, width };
  }

  return (
    <>
      {/* Dims everything but the step's element. Clicks pass straight through. */}
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[55] rounded-2xl transition-all duration-300 motion-reduce:transition-none"
          style={{
            left: box.x - 6,
            top: box.y - 6,
            width: box.width + 12,
            height: box.height + 12,
            boxShadow:
              "0 0 0 3px var(--primary), 0 0 0 9999px color-mix(in oklab, var(--foreground) 45%, transparent)",
          }}
        />
      ) : (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[55]"
          style={{ background: "color-mix(in oklab, var(--foreground) 45%, transparent)" }}
        />
      )}

      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-labelledby="demo-tour-title"
        className="tint-primary premium-card fixed z-[60] max-h-[calc(100dvh-32px)] overflow-auto p-5 shadow-2xl"
        style={{ ...style, background: "var(--card)" }}
      >
        <div className="flex items-center gap-2">
          <p className="eyebrow">
            Guided tour · {step.chapter} · <span className="numeral">{counter}</span>
          </p>
          <button
            type="button"
            onClick={() => go(null)}
            aria-label="End the tour"
            className="btn-ghost ml-auto rounded-lg p-1.5"
          >
            <X className="size-4" />
          </button>
        </div>
        <div aria-live="polite" aria-atomic="true">
          <h2 id="demo-tour-title" className="mt-3 text-xl font-extrabold">
            {step.title}
          </h2>
          <p className="text-muted-foreground mt-2 mb-4 text-sm leading-relaxed">{step.body}</p>
        </div>
        <Meter value={((index + 1) / TOUR_STEPS.length) * 100} size="sm" />
        <div className="mt-4 flex items-center gap-2">
          {index > 0 && (
            <button
              type="button"
              onClick={() => go(index - 1)}
              className="btn-premium inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm"
            >
              <ArrowLeft className="size-4" aria-hidden /> Back
            </button>
          )}
          <div className="ml-auto flex gap-2">
            {last ? (
              <>
                <button
                  type="button"
                  onClick={() => go(null)}
                  className="btn-premium rounded-xl px-3 py-2 text-sm"
                >
                  Keep exploring
                </button>
                <Link
                  to="/"
                  onClick={() => go(null)}
                  className="btn-solid inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm"
                >
                  Join now <ArrowRight className="size-4" aria-hidden />
                </Link>
              </>
            ) : (
              <button
                type="button"
                autoFocus
                onClick={() => go(index + 1)}
                className="btn-solid inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm"
              >
                {index === 0 ? "Start the tour" : "Next"}
                <ArrowRight className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
