import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lightbulb, RotateCcw } from "lucide-react";

/** How long the mouse rests on a card before it turns, so scrolling past doesn't. */
const PEEK_DELAY_MS = 350;

/**
 * A marked quiz question that turns over to show its explanation.
 *
 * "Why?" turns it, and it stays turned until "Back to the question". On a
 * computer, resting the mouse on the card turns it too and moving off turns it
 * back; a click while it is turned keeps it turned. With no `back` it is the
 * plain card, so a question with no explanation (or not marked yet) never turns.
 */
export function QuestionFlipCard({ front, back }: { front: ReactNode; back: ReactNode | null }) {
  const [pinned, setPinned] = useState(false);
  const [peek, setPeek] = useState(false);
  const flipped = back != null && (pinned || peek);

  const cardRef = useRef<HTMLLIElement>(null);
  const whyRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<HTMLButtonElement>(null);
  const peekTimer = useRef<number | undefined>(undefined);
  const mouseInside = useRef(false);
  // "Back to the question" under the mouse would turn straight back over, so
  // the card waits for the mouse to leave before it peeks again.
  const held = useRef(false);
  // Set by the buttons only, so a peek never moves focus.
  const focusNext = useRef<"why" | "return" | null>(null);

  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (next === "why") whyRef.current?.focus({ preventScroll: true });
    if (next !== "return") return;
    returnRef.current?.focus({ preventScroll: true });
    // "Why?" sits at the foot of the card, and on a phone a tall question has
    // its top under the header by then: bring the explanation's start into view.
    const card = cardRef.current;
    if (card && card.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }, [flipped]);

  return (
    <li
      ref={cardRef}
      className="flip-card scroll-mt-28"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        mouseInside.current = true;
        if (back == null || held.current) return;
        window.clearTimeout(peekTimer.current);
        peekTimer.current = window.setTimeout(() => setPeek(true), PEEK_DELAY_MS);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        mouseInside.current = false;
        held.current = false;
        window.clearTimeout(peekTimer.current);
        setPeek(false);
      }}
    >
      <div className={`flip-card-inner${flipped ? " is-flipped" : ""}`}>
        <div
          className="flip-face flip-front flex flex-col rounded-2xl premium-card p-4 sm:p-5"
          inert={flipped}
        >
          {front}
          {back != null && (
            <div className="mt-auto flex justify-end pt-4">
              <button
                ref={whyRef}
                type="button"
                onClick={() => {
                  focusNext.current = "return";
                  setPinned(true);
                }}
                className="btn-soft tint-amber inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm sm:pointer-fine:min-h-9"
              >
                <Lightbulb className="size-4" aria-hidden />
                Why?
              </button>
            </div>
          )}
        </div>
        {back != null && (
          <div
            className="flip-face flip-back tint-amber flex flex-col rounded-2xl premium-card wash-top p-4 sm:p-6"
            inert={!flipped}
            onClick={() => {
              if (peek) setPinned(true);
            }}
          >
            {back}
            <div className="mt-auto flex justify-end pt-5">
              <button
                ref={returnRef}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.clearTimeout(peekTimer.current);
                  held.current = mouseInside.current;
                  focusNext.current = "why";
                  setPinned(false);
                  setPeek(false);
                }}
                className="btn-soft inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm sm:pointer-fine:min-h-9"
              >
                <RotateCcw className="size-4" aria-hidden />
                Back to the question
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
