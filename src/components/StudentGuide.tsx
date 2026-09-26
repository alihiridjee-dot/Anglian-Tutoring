import { pageGuides, pageIntroductions, type GuideStep } from "@/lib/shell/pageGuides";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { getSessionUserId, isDemoMode } from "@/lib/auth/session";
import { Meter } from "@/components/Shared";

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
    body: "Homework & Grades brings your assignments and results together. Check what’s been set and return here to review your feedback.",
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

function findTarget(step: GuideStep) {
  return Array.from(
    document.querySelectorAll<HTMLElement>(step.selector ?? `[data-guide="${step.target}"]`),
  ).find(
    (element) =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
  );
}

export function StudentGuide({
  pageTitle,
  autoStart = false,
  guideKey = pageTitle,
}: {
  pageTitle: string;
  autoStart?: boolean;
  guideKey?: string;
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
  const [cardHeight, setCardHeight] = useState(310);
  const [box, setBox] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const storageKey = useRef<string | null>(null);
  const start = () => {
    setAvailable(steps.filter((step) => findTarget(step)));
    setIndex(0);
  };

  useEffect(() => {
    let cancelled = false;
    if (autoStart && !isDemoMode()) {
      void getSessionUserId()
        .then((id) => {
          if (cancelled || !id) return;
          storageKey.current = `student-guide:${id}`;
          try {
            if (localStorage.getItem(storageKey.current) === "pending") start();
          } catch {
            /* Manual replay remains available. */
          }
        })
        .catch(() => {
          /* Session guard handles authentication failures. */
        });
    }
    return () => {
      cancelled = true;
    };
    // This component is keyed by page in AppLayout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const close = () => {
    try {
      if (storageKey.current) localStorage.setItem(storageKey.current, "seen");
    } catch {
      /* Storage must never prevent closing the tour. */
    }
    dialog.current?.close();
    setIndex(null);
    trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (index === null) return;
    const modal = dialog.current;
    modal?.showModal();
    const target = findTarget(available[index]);
    target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const measure = () => {
      const rect = target?.getBoundingClientRect();
      setBox(rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null);
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      if (card.current) setCardHeight(card.current.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    if (card.current) observer.observe(card.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [index, available]);

  const width = Math.min(360, viewport.width - 32);
  const beside = box && viewport.width >= 640 && box.x + box.width + width + 48 < viewport.width;
  const left = beside
    ? box.x + box.width + 28
    : Math.max(16, Math.min(box?.x ?? 16, viewport.width - width - 16));
  const below = box && box.y + box.height + cardHeight + 44 < viewport.height;
  const top = beside
    ? Math.max(16, Math.min(box.y, viewport.height - cardHeight - 16))
    : below
      ? box.y + box.height + 28
      : box && box.y > cardHeight + 44
        ? box.y - cardHeight - 28
        : Math.max(16, viewport.height - cardHeight - 16);
  const step = index === null ? null : available[index];

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
      {step && (
        <dialog
          ref={dialog}
          aria-labelledby="student-guide-title"
          aria-describedby="student-guide-description"
          onCancel={(event) => {
            event.preventDefault();
            close();
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
              <>
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
                <path
                  d={
                    beside
                      ? `M ${left} ${top + 30} L ${box.x + box.width + 9} ${box.y + box.height / 2}`
                      : top >= box.y + box.height
                        ? `M ${left + width / 2} ${top} L ${box.x + box.width / 2} ${box.y + box.height + 9}`
                        : `M ${left + width / 2} ${top + cardHeight} L ${box.x + box.width / 2} ${box.y - 9}`
                  }
                  fill="none"
                  stroke="var(--tint)"
                  strokeWidth="3"
                  markerEnd="url(#student-guide-arrow)"
                />
              </>
            )}
          </svg>
          <div
            ref={card}
            className="premium-card fixed p-5 sm:p-6 overflow-auto"
            style={{
              left,
              top,
              width,
              maxHeight: "calc(100dvh - 32px)",
              background: "var(--card)",
            }}
          >
            <div aria-live="polite" aria-atomic="true">
              <p className="eyebrow mb-3">
                Your quick guide · {index! + 1} / {available.length}
              </p>
              <h2 id="student-guide-title" className="text-xl font-extrabold">
                {step.title}
              </h2>
              <p
                id="student-guide-description"
                className="mt-3 mb-5 text-sm leading-relaxed text-muted-foreground"
              >
                {step.body}
              </p>
            </div>
            <Meter value={((index! + 1) / available.length) * 100} size="sm" />
            <div className="mt-5 flex items-center gap-2">
              <button onClick={close} className="btn-ghost min-h-11 rounded-xl px-2 py-2 text-sm">
                Skip
              </button>
              <div className="ml-auto flex gap-2">
                {index! > 0 && (
                  <button
                    onClick={() => setIndex(index! - 1)}
                    className="btn-premium min-h-11 rounded-xl px-3 py-2 text-sm"
                  >
                    Back
                  </button>
                )}
                <button
                  autoFocus
                  onClick={() => (index === available.length - 1 ? close() : setIndex(index! + 1))}
                  className="btn-solid inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm"
                >
                  {index === available.length - 1 ? "Let’s go" : "Next"}
                  <ArrowRight className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
