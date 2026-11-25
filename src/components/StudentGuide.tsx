import { pageGuides, pageIntroductions, type GuideStep } from "@/lib/shell/pageGuides";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Confetti } from "@/components/Doodles";
import { cn } from "@/lib/utils";
import { startWelcomeTour } from "@/lib/shell/welcomeTour";

/**
 * The showcase dashboard's short tour. Signed-in students get the welcome tour
 * on their dashboard instead (see `welcome` below), which visits each of these
 * sections rather than pointing at their links.
 */
const dashboardSteps: GuideStep[] = [
  {
    target: "guide",
    title: "Your starting point",
    body: "Welcome! Your dashboard brings together your weekly study plan, upcoming lessons and extra focus from your tutor. Let’s find your way around.",
  },
  {
    target: "planner",
    title: "Know what to study next",
    body: "Open Planner to follow your weekly study plan. Start with the work set for you and return to your dashboard to see what’s coming up.",
  },
  {
    target: "live",
    title: "Join your live lessons",
    body: "Live Sessions is where you find your classes and joining details. Your dashboard also shows upcoming sessions so you can get ready in time.",
  },
  {
    target: "curriculum",
    title: "Find your topic",
    body: "Open Curriculum to explore your subjects and topics. Find the learning resources for the topic you’re working on.",
  },
  {
    target: "homework",
    title: "Keep track of your work",
    body: "Tasks & Grades brings your assignments and results together. Check what’s been set and return here to review your feedback.",
  },
  {
    target: "mcqs",
    title: "Check your understanding",
    body: "Use MCQs for multiple-choice practice. Try a question set to see what you know and what needs another look.",
  },
  {
    target: "search",
    title: "Find things quickly",
    body: "Use the magnifying glass to search the platform. You can also press Ctrl K on Windows or ⌘ K on Mac.",
  },
  {
    target: "guide",
    title: "You’re ready to explore",
    body: "Start with your weekly plan. Whenever you need a reminder, press the 🧭 at the top to take this tour again.",
  },
];

/**
 * The first element matching `selector` that is actually on screen. A wrapper
 * whose content rendered nothing still matches its selector, so an empty box
 * counts as missing rather than as something to point at.
 */
function findVisible(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
  });
}

const selectorOf = (step: GuideStep) => step.selector ?? `[data-guide="${step.target}"]`;

/**
 * The 🧭 "Show me around" button, and a tour of the page it sits on.
 *
 * On a home page (`welcome`) the button replays the welcome tour instead, which
 * walks through the whole platform rather than one page. The showcase never
 * passes it, so the demo dashboard keeps its short tour.
 */
export function StudentGuide({
  pageTitle,
  guideKey = pageTitle,
  welcome = false,
}: {
  pageTitle: string;
  guideKey?: string;
  welcome?: boolean;
}) {
  const steps =
    pageTitle === "Student Dashboard"
      ? dashboardSteps
      : [
          {
            target: "guide",
            title: `Let’s explore ${pageTitle}`,
            body:
              pageIntroductions[guideKey] ??
              "Select Next for a quick look at the controls on this page.",
          },
          ...(pageGuides[guideKey] ?? [
            {
              target: "page-content",
              title: pageTitle,
              body: "This is your current workspace. Follow the headings and available controls to explore the content here.",
            },
          ]),
          {
            target: "guide",
            title: "Off you go!",
            body: "You can take this page’s tour again any time. Just press the 🧭 at the top.",
          },
        ];
  const [index, setIndex] = useState<number | null>(null);
  const [available, setAvailable] = useState(steps);
  const trigger = useRef<HTMLButtonElement>(null);
  const start = () => {
    if (welcome) {
      startWelcomeTour();
      return;
    }
    setAvailable(steps.filter((step) => findVisible(selectorOf(step))));
    setIndex(0);
  };
  const close = () => {
    setIndex(null);
    // Once the dialog has gone: nothing outside an open modal can take focus.
    window.setTimeout(() => trigger.current?.focus({ preventScroll: true }));
  };
  const step = index === null ? null : available[index];
  const last = index === available.length - 1;

  return (
    <>
      <button
        ref={trigger}
        data-guide="guide"
        onClick={start}
        title="Show me around"
        aria-label="Show me around"
        className="btn-soft tint-amber flex size-11 cursor-pointer items-center justify-center rounded-xl text-lg sm:pointer-fine:size-9"
      >
        <span aria-hidden="true">🧭</span>
      </button>
      {step && index !== null && (
        <GuideOverlay
          stepId={String(index)}
          place="dock"
          targets={[selectorOf(step)]}
          stops={available.map((s) => ({ label: s.title }))}
          current={index}
          tint="tint-amber"
          title={step.title}
          onClose={close}
          onBack={index > 0 ? () => setIndex(index - 1) : undefined}
          onNext={() => (last ? close() : setIndex(index + 1))}
          nextLabel={last ? "Let’s go" : "Next"}
        >
          <p>{step.body}</p>
        </GuideOverlay>
      )}
    </>
  );
}

/** How long an element is waited on to stop moving before it is taken anyway. */
const SEARCH_MS = 4000;
/** How long a step's first-choice element is waited for before a fallback will do. */
const PREFER_MS = 2500;
/** Room left between the pinned page header and the top of what a step is about. */
const HEADROOM = 24;

/** One stop on the tour's trail. */
export interface TourStop {
  /** What the stop holds. Without one, the stop holds its number. */
  emoji?: string;
  /** The step's name, read out with the trail. */
  label: string;
  /** The stop's colour, a `tint-*` class. */
  tint?: string;
}

/** How much of a tall section has to show above the docked card. */
const SHOWN = 220;

/**
 * Brings what a step is about into the clear part of the screen: below the
 * pinned page header, above the docked card. The page moves as little as it
 * can, so what sits above the section stays in view where it fits; nothing
 * moves when it is already clear, and nothing pinned to the screen is ever
 * scrolled to.
 */
function bringIntoView(element: HTMLElement, cardHeight: number) {
  if (!element.isConnected || element.closest("main > header, #app-sidebar")) return;
  const header = document.querySelector("main > header")?.getBoundingClientRect().bottom ?? 0;
  const top = Math.max(header, 0) + HEADROOM;
  // On a phone turned sideways the card docks to the side, not the bottom.
  const sideways = window.matchMedia("(height <= 31.25rem)").matches;
  const floor = window.innerHeight - (sideways ? 24 : cardHeight + 40);
  const box = element.getBoundingClientRect();
  // Up until its top is clear of the header, or down until enough of it shows
  // above the card, but never so far that its top goes under the header.
  const by =
    box.top < top
      ? box.top - top
      : Math.min(box.top - top, Math.max(0, box.top + Math.min(box.height, SHOWN) - floor));
  if (Math.abs(by) < 1) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: window.scrollY + by, behavior: still ? "instant" : "smooth" });
}

/** How far the ring reaches outside its element: its width and widest offset. */
const REACH = 13;

/**
 * Where the ring can be seen. An outline is painted outside its element, so a
 * parent that clips (a rounded card, a scroller) can cut it off. When the
 * element fills that parent, as a topic's button fills its card, the parent is
 * ringed instead; when it only sits close to the parent's edge, the ring is
 * drawn just inside the element.
 */
function ringable(element: HTMLElement) {
  let target = element;
  for (
    let parent = element.parentElement;
    parent && parent !== document.body;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const clipsX = style.overflowX !== "visible";
    const clipsY = style.overflowY !== "visible";
    if (!clipsX && !clipsY) continue;
    const inner = target.getBoundingClientRect();
    const outer = parent.getBoundingClientRect();
    const x = [inner.left - outer.left, outer.right - inner.right];
    const y = [inner.top - outer.top, outer.bottom - inner.bottom];
    if ([...(clipsX ? x : []), ...(clipsY ? y : [])].every((gap) => gap >= REACH)) continue;
    if ([...x, ...y].every((gap) => gap < 16)) {
      target = parent;
      continue;
    }
    return { target, inset: true };
  }
  return { target, inset: false };
}

/**
 * Rings an element, and undoes it. A wrapper with square corners (a list's
 * grid, a section) is rounded while it is ringed, so the ring matches the
 * rounded cards inside it. Only one that doesn't clip its content: rounding
 * one that does would cut its children's corners. A ring drawn inside gets a
 * small rounding either way, which only touches the corners' padding.
 */
function ring(element: HTMLElement, colour: string) {
  const { target, inset } = ringable(element);
  const style = getComputedStyle(target);
  const square = style.borderTopLeftRadius === "0px" && (inset || style.overflow === "visible");
  if (colour) target.style.setProperty("--tour-ring", colour);
  if (square) target.style.borderRadius = inset ? "0.75rem" : "1.25rem";
  target.setAttribute("data-tour-lit", inset ? "inset" : "");
  return () => {
    target.removeAttribute("data-tour-lit");
    target.style.removeProperty("--tour-ring");
    if (square) target.style.removeProperty("border-radius");
  };
}

/**
 * Rings what the step is about, on the page itself.
 *
 * The ring is the element's own outline (`[data-tour-lit]` in styles.css), so
 * the browser draws it exactly round the element and it moves with the page:
 * nothing is measured to place it, and nothing can drift out of line with it.
 *
 * `targetKey` is the step's selectors, one per line, tried in order; null when
 * there is nothing to look for yet. A page draws its content after its data
 * arrives, so the search keeps looking, and an element is taken once it has
 * stopped moving: content still loading above it pushes it down after it first
 * appears. It keeps watching after that, because a page can draw the same thing
 * again (each route draws its own header, and a page swaps its loading state
 * for its content): the ring then moves to the new one.
 */
function useTourRing(
  stepId: string,
  targetKey: string | null,
  card: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!targetKey) return;
    const selectors = targetKey.split("\n").filter(Boolean);
    const began = Date.now();
    // The first choice gets a head start. A fallback is usually something that
    // renders before the data does, so taking it at once would ring the
    // fallback on every page that is still loading its first choice.
    const search = () => {
      const tries = Date.now() - began > PREFER_MS ? selectors : selectors.slice(0, 1);
      for (const selector of tries) {
        const element = findVisible(selector);
        if (element) return element;
      }
      return null;
    };
    let last: { element: HTMLElement; top: number } | null = null;
    let lit: { element: HTMLElement; undo: () => void } | null = null;
    const later: number[] = [];
    const check = () => {
      if (lit?.element.isConnected) return;
      lit?.undo();
      lit = null;
      const element = search();
      const top = element?.getBoundingClientRect().top ?? 0;
      const still = !!element && last?.element === element && Math.abs(last.top - top) < 1;
      last = element ? { element, top } : null;
      if (!element || (!still && Date.now() - began <= SEARCH_MS)) return;
      // The ring is the step's colour, which the card already wears.
      const tint = card.current ? getComputedStyle(card.current).getPropertyValue("--tint") : "";
      lit = { element, undo: ring(element, tint.trim()) };
      const show = () => bringIntoView(element, card.current?.offsetHeight ?? 0);
      show();
      // Again a moment later: arriving on a page resets its scroll, and that
      // can land after this first move and undo it. Each look is a no-op once
      // the element is in the clear.
      later.push(window.setTimeout(show, 600), window.setTimeout(show, 1400));
    };
    const poll = window.setInterval(check, 150);
    check();
    return () => {
      window.clearInterval(poll);
      later.forEach((timer) => window.clearTimeout(timer));
      lit?.undo();
    };
  }, [stepId, targetKey, card]);
}

/** The tour's progress: a stop per step on a dotted line, drawn in as it goes. */
function TourTrail({ stops, current }: { stops: TourStop[]; current: number }) {
  return (
    <div
      role="img"
      aria-label={`Step ${current + 1} of ${stops.length}: ${stops[current]?.label ?? ""}`}
      className="tour-trail"
      style={{ "--progress": stops.length > 1 ? current / (stops.length - 1) : 1 } as CSSProperties}
    >
      {stops.map((stop, i) => (
        <span
          key={i}
          aria-hidden
          className={cn("tour-stop", stop.tint)}
          data-state={i < current ? "done" : i === current ? "now" : "next"}
        >
          {stop.emoji ?? i + 1}
        </span>
      ))}
    </div>
  );
}

/**
 * The tour's card, shared by the page tour above and the welcome tour
 * (`WelcomeTour`). It is a modal dialog: the page underneath can be seen and
 * scrolled but not used until the tour ends, so nothing is clicked by accident.
 * A click on the page nudges Next instead.
 *
 * The card is only ever in one of two places, both centred, so it never
 * wanders: `centre`, in the middle of a dimmed screen, for a step that explains
 * an idea; and `dock`, at the bottom, centred under the page it is talking
 * about, with what the step is about ringed on the page. It glides between
 * the two.
 *
 * `targets` are the selectors for the element to ring, tried in order. Left
 * out while the step's page is still on its way.
 */
export function GuideOverlay({
  stepId,
  place,
  targets,
  stops,
  current,
  tint = "tint-primary",
  icon,
  title,
  peek,
  celebrate = false,
  children,
  onClose,
  onBack,
  onNext,
  nextLabel,
  closeLabel = "Skip",
}: {
  /** Changes with every step, so the same selector on a new page is searched again. */
  stepId: string;
  place: "centre" | "dock";
  targets?: string[];
  stops: TourStop[];
  /** Which stop this step is. */
  current: number;
  /** The step's colour, a `tint-*` class: the card, its trail and the ring wear it. */
  tint?: string;
  /** Shown in an icon tile beside the title: the page's sidebar icon. */
  icon?: ReactNode;
  title: string;
  /** A character peeking over the card's top edge. */
  peek?: ReactNode;
  /** Confetti from the top of the card, for the last step. */
  celebrate?: boolean;
  children: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
  /** Null leaves it out, for a last step whose Next already ends the tour. */
  closeLabel?: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  useTourRing(stepId, place === "dock" && targets ? targets.join("\n") : null, card);

  useEffect(() => {
    const modal = dialog.current;
    if (modal && !modal.open) modal.showModal();
    // showModal() focuses the first button, Skip; Enter should mean Next.
    next.current?.focus({ preventScroll: true });
    return () => modal?.close();
  }, []);

  // While the card is docked, the page gets room at its foot as tall as the
  // card (`html[data-tour]` in styles.css), so whatever a step is about can be
  // scrolled clear of it, even at the end of a short page.
  useEffect(() => {
    const root = document.documentElement;
    const element = card.current;
    root.dataset.tour = place;
    if (!element) return;
    const measure = () => root.style.setProperty("--tour-card-h", `${element.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      delete root.dataset.tour;
      root.style.removeProperty("--tour-card-h");
    };
  }, [place]);

  const nudge = () => {
    const button = next.current;
    if (!button) return;
    button.classList.remove("tour-nudge");
    void button.offsetWidth;
    button.classList.add("tour-nudge");
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="student-guide-title"
      aria-describedby="student-guide-description"
      data-place={place}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (!card.current?.contains(event.target as Node)) nudge();
      }}
      className="tour fixed inset-0 m-0 size-auto max-h-none max-w-none overflow-hidden border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent"
    >
      <div className="tour-dim" aria-hidden />
      <div ref={card} data-place={place} className={cn("tour-card premium-card", tint)}>
        {peek && <div className="tour-peek">{peek}</div>}
        {celebrate && <Confetti key={stepId} />}
        <TourTrail stops={stops} current={current} />
        {/* The words scroll and the buttons stay, when the card is capped at
            the screen's height. */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="scroll-slim -mx-1 min-h-0 overflow-y-auto px-1 pb-1"
        >
          <div key={stepId} className="tour-step">
            <div className="flex items-center gap-3">
              {icon && (
                <span className="icon-tile size-11 shrink-0" aria-hidden>
                  {icon}
                </span>
              )}
              <h2
                id="student-guide-title"
                className="text-xl leading-tight font-extrabold text-balance sm:text-2xl"
              >
                {title}
              </h2>
            </div>
            <div
              id="student-guide-description"
              className="mt-3 space-y-3 text-[0.95rem] leading-relaxed sm:text-base"
            >
              {children}
            </div>
          </div>
        </div>
        <div className="mt-5 flex shrink-0 items-center gap-2 short:mt-3">
          {closeLabel !== null && (
            <button onClick={onClose} className="btn-ghost min-h-11 rounded-xl px-2 py-2 text-sm">
              {closeLabel}
            </button>
          )}
          {/* Next is the same blue on every step, wherever the card's colour goes. */}
          <div className="tint-primary ml-auto flex gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="btn-premium min-h-11 rounded-xl px-3 py-2 text-sm"
              >
                Back
              </button>
            )}
            <button
              ref={next}
              onClick={onNext}
              onAnimationEnd={(event) => event.currentTarget.classList.remove("tour-nudge")}
              className="btn-solid inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm"
            >
              {nextLabel}
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
