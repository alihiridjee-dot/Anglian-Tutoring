import { pageGuides, pageIntroductions, type GuideStep } from "@/lib/shell/pageGuides";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Meter } from "@/components/Shared";
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
    body: "Start with your weekly plan. Whenever you need a reminder, select Show me around in the top ribbon to take this tour again.",
  },
];
type Box = { x: number; y: number; width: number; height: number };

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
 * The "Show me around" button, and a tour of the page it sits on.
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
            body: "You can take this page’s tour again any time. Look for 🧭 Show me around in the top ribbon.",
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
        className="btn-premium inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm tint-primary sm:min-h-0"
      >
        <span aria-hidden="true">🧭</span> Show me around
      </button>
      {step && index !== null && (
        <GuideOverlay
          stepId={String(index)}
          targets={[selectorOf(step)]}
          eyebrow={`Your quick guide · ${index + 1} / ${available.length}`}
          title={step.title}
          progress={(index + 1) / available.length}
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

/** How long the spotlight takes to travel from one element to the next. */
const GLIDE_MS = 320;
/** How long to wait for a step's element before showing the card without it. */
const SEARCH_MS = 4000;
/** How long a step's first-choice element is waited for before a fallback will do. */
const PREFER_MS = 2500;
/** The smallest part of a tall section that is lit, however little room is left. */
const MIN_LIT = 120;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const between = (a: Box, b: Box, t: number): Box => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  width: a.width + (b.width - a.width) * t,
  height: a.height + (b.height - a.height) * t,
});

/**
 * Where the spotlight is, frame by frame.
 *
 * `targetKey` is the step's selectors, one per line, tried in order: "" means
 * the step has nothing to point at, and null means its page is still on its way
 * so there is nothing to search yet. A page draws its content after its data
 * arrives, so the search keeps looking for a few seconds before giving up.
 *
 * Once found, the element is brought into view and the spotlight glides to it
 * from wherever it last was, or opens out from its centre if nothing was lit.
 * From then on it follows the element as the page scrolls, resizes, or loads
 * something above it and pushes it down.
 */
function useSpotlight(stepId: string, targetKey: string | null, cardHeight: number) {
  // Undefined while searching; null when there is nothing to point at.
  const [target, setTarget] = useState<HTMLElement | null | undefined>(undefined);
  const [box, setBox] = useState<Box | null>(null);
  const [settled, setSettled] = useState(false);
  const shown = useRef<Box | null>(null);
  // The card's height, read when the box is, without restarting the glide.
  const reserve = useRef(cardHeight);
  reserve.current = cardHeight;
  const refollow = useRef<(() => void) | null>(null);

  useEffect(() => {
    setTarget(undefined);
    if (targetKey === null) return;
    const selectors = targetKey.split("\n").filter(Boolean);
    if (selectors.length === 0) {
      setTarget(null);
      return;
    }
    const began = Date.now();
    // The first choice gets a head start. A fallback is usually something that
    // renders before the data does, so taking it at once would light the
    // fallback on every page that is still loading its first choice.
    const search = () => {
      const tries = Date.now() - began > PREFER_MS ? selectors : selectors.slice(0, 1);
      for (const selector of tries) {
        const element = findVisible(selector);
        if (element) return element;
      }
      return null;
    };
    // Taken once it has stopped moving: content still loading above an element
    // pushes it down after it first appears, and away from where it was scrolled.
    let last: { element: HTMLElement; top: number } | null = null;
    const check = () => {
      const element = search();
      const top = element?.getBoundingClientRect().top ?? 0;
      const still = !!element && last?.element === element && Math.abs(last.top - top) < 1;
      last = element ? { element, top } : null;
      if (still || Date.now() - began > SEARCH_MS) {
        window.clearInterval(poll);
        setTarget(element);
      }
    };
    const poll = window.setInterval(check, 120);
    check();
    return () => window.clearInterval(poll);
  }, [stepId, targetKey]);

  useEffect(() => {
    setSettled(false);
    if (!target) {
      shown.current = null;
      setBox(null);
      return;
    }
    // Up to just below the sticky page header, leaving the rest of the screen
    // under it for the card. A short page can't scroll an element near its end
    // that far, so it is lengthened by a screen of empty space while the step
    // is open.
    const header =
      (document.querySelector("main > header")?.getBoundingClientRect().height ?? 0) + 16;
    const content = target.closest<HTMLElement>('[data-guide="page-content"]');
    const padding = content?.style.paddingBottom ?? "";
    if (content) content.style.paddingBottom = `${visibleSize().height}px`;
    const margin = target.style.scrollMarginTop;
    target.style.scrollMarginTop = `${header}px`;
    target.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    target.style.scrollMarginTop = margin;
    // A section too tall to leave room for the card under it is lit from its
    // top down only, so the card never sits on top of what it describes.
    const read = (): Box => {
      const r = target.getBoundingClientRect();
      const room = visibleSize().height - Math.max(r.y, header) - reserve.current - 60;
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: Math.min(r.height, Math.max(MIN_LIT, room)),
      };
    };
    const first = read();
    const from = shown.current ?? {
      x: first.x + first.width / 2,
      y: first.y + first.height / 2,
      width: 0,
      height: 0,
    };
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const began = performance.now();
    let frame = 0;
    const glide = (now: number) => {
      const t = still ? 1 : Math.min(1, (now - began) / GLIDE_MS);
      const next = t < 1 ? between(from, read(), easeOut(t)) : read();
      shown.current = next;
      setBox(next);
      if (t < 1) {
        frame = requestAnimationFrame(glide);
      } else {
        frame = 0;
        setSettled(true);
      }
    };
    frame = requestAnimationFrame(glide);

    // Mid-glide every frame reads the element already.
    const follow = () => {
      if (frame) return;
      shown.current = read();
      setBox(shown.current);
    };
    const observer = new ResizeObserver(follow);
    observer.observe(target);
    // Content arriving above the element moves it without resizing it.
    if (content) observer.observe(content);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    refollow.current = follow;
    return () => {
      refollow.current = null;
      if (content) content.style.paddingBottom = padding;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [target]);

  // A new step's card can be taller than the last, and needs its room.
  useEffect(() => refollow.current?.(), [cardHeight]);

  return { box, settled, searching: target === undefined };
}

/**
 * The spotlight and its card, shared by the page tour above and the welcome
 * tour (`WelcomeTour`). It is a modal dialog: the page underneath can be seen
 * but not used until the tour ends, so nothing is clicked by accident.
 *
 * `targets` are the selectors for the element to point at, tried in order.
 * Empty centres the card with nothing lit. Undefined means the step's page is
 * still loading: the card holds its place and everything dims until it lands.
 */
export function GuideOverlay({
  stepId,
  targets,
  eyebrow,
  icon,
  title,
  children,
  progress,
  onClose,
  onBack,
  onNext,
  nextLabel,
  closeLabel = "Skip",
  wide = false,
}: {
  /** Changes with every step, so the same selector on a new page is searched again. */
  stepId: string;
  targets: string[] | undefined;
  eyebrow: string;
  /** Shown in an icon tile beside the title. */
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  /** How far through the tour, from 0 to 1. */
  progress: number;
  onClose: () => void;
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
  /** Null leaves it out, for a last step whose Next already ends the tour. */
  closeLabel?: string | null;
  /** Room for a picture beside the words, for the steps that explain an idea. */
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(310);
  const [viewport, setViewport] = useState(() =>
    typeof window === "undefined" ? { width: 0, height: 0 } : visibleSize(),
  );
  const { box, settled, searching } = useSpotlight(
    stepId,
    targets ? targets.join("\n") : null,
    cardHeight,
  );
  const parked = useRef<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const modal = dialog.current;
    if (modal && !modal.open) modal.showModal();
    const measure = () => {
      setViewport(visibleSize());
      if (card.current) setCardHeight(card.current.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (card.current) observer.observe(card.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      modal?.close();
    };
  }, []);

  const width = Math.min(wide ? 440 : 360, viewport.width - 32);
  let left: number;
  let top: number;
  let arrow: string | null = null;
  if (box) {
    // Beside the element when there's room, else below it, else above it,
    // else against whichever edge of the screen is further from it.
    const beside = viewport.width >= 640 && box.x + box.width + width + 48 < viewport.width;
    const below = box.y + box.height + cardHeight + 44 < viewport.height;
    const above = box.y > cardHeight + 44;
    const lowerHalf = box.y + box.height / 2 > viewport.height / 2;
    left = beside
      ? box.x + box.width + 28
      : Math.max(16, Math.min(box.x, viewport.width - width - 16));
    top = beside
      ? Math.max(16, Math.min(box.y, viewport.height - cardHeight - 16))
      : below
        ? box.y + box.height + 28
        : above
          ? box.y - cardHeight - 28
          : lowerHalf
            ? 16
            : Math.max(16, viewport.height - cardHeight - 16);
    if (settled && (beside || below || above)) {
      arrow = beside
        ? `M ${left} ${top + 30} L ${box.x + box.width + 9} ${box.y + box.height / 2}`
        : below
          ? `M ${left + width / 2} ${top} L ${box.x + box.width / 2} ${box.y + box.height + 9}`
          : `M ${left + width / 2} ${top + cardHeight} L ${box.x + box.width / 2} ${box.y - 9}`;
    }
  } else if (searching && parked.current) {
    ({ left, top } = parked.current);
  } else {
    left = Math.max(16, (viewport.width - width) / 2);
    top = Math.max(16, (viewport.height - cardHeight) / 2);
  }
  useEffect(() => {
    parked.current = { left, top };
  }, [left, top]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="student-guide-title"
      aria-describedby="student-guide-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent tint-primary"
    >
      <svg className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <mask id="student-guide-mask">
            <rect width="100%" height="100%" fill="white" />
            {box && (
              <rect
                x={box.x - 5}
                y={box.y - 5}
                width={box.width + 10}
                height={box.height + 10}
                rx="14"
                fill="black"
              />
            )}
          </mask>
          <marker
            id="student-guide-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6" fill="none" stroke="var(--tint)" strokeWidth="2" />
          </marker>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="var(--foreground)"
          opacity="0.55"
          mask="url(#student-guide-mask)"
        />
        {box && (
          <rect
            x={box.x - 5}
            y={box.y - 5}
            width={box.width + 10}
            height={box.height + 10}
            rx="14"
            fill="none"
            stroke="var(--tint)"
            strokeWidth="3"
          />
        )}
        {arrow && (
          <path
            d={arrow}
            fill="none"
            stroke="var(--tint)"
            strokeWidth="3"
            markerEnd="url(#student-guide-arrow)"
          />
        )}
      </svg>
      <div
        ref={card}
        className="premium-card fixed overflow-auto p-5 transition-[left,top] duration-300 ease-out motion-reduce:transition-none sm:p-6"
        style={{
          left,
          top,
          width,
          maxHeight: "calc(100dvh - 32px)",
          background: "var(--card)",
        }}
      >
        <div aria-live="polite" aria-atomic="true">
          <p className="eyebrow mb-3">{eyebrow}</p>
          <div className="flex items-center gap-3">
            {icon && (
              <span className="icon-tile size-10 shrink-0" aria-hidden>
                {icon}
              </span>
            )}
            <h2 id="student-guide-title" className="text-xl font-extrabold">
              {title}
            </h2>
          </div>
          <div
            id="student-guide-description"
            className="mt-3 mb-5 space-y-3 text-[0.95rem] leading-relaxed"
          >
            {children}
          </div>
        </div>
        <Meter value={progress * 100} size="sm" />
        <div className="mt-5 flex items-center gap-2">
          {closeLabel !== null && (
            <button onClick={onClose} className="btn-ghost min-h-11 rounded-xl px-2 py-2 text-sm">
              {closeLabel}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="btn-premium min-h-11 rounded-xl px-3 py-2 text-sm"
              >
                Back
              </button>
            )}
            <button
              autoFocus
              onClick={onNext}
              className="btn-solid inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm"
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
