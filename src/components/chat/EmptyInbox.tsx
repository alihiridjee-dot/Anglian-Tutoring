import { useState } from "react";
import { ArrowRight, Inbox, MessageSquarePlus } from "lucide-react";

/** The highlighter stroke under a title, as on the spec point and paywall. */
export function Squiggle({ className = "mx-auto" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`point-squiggle ${className}`}
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
    >
      <path d="M2 8 Q 18 1 34 7 T 66 6 T 98 5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * An inbox with nothing in it, in the paywall's look: no card, a solid round
 * dot, the title on the page with the highlighter stroke, one dark line and
 * one big button. Pointing at the button makes the speech bubble in the dot
 * hop. A tutor gets the same look, and their button writes to a student or a
 * parent first.
 */
export function EmptyInbox({ isTutor, onAsk }: { isTutor: boolean; onAsk: () => void }) {
  const [reaching, setReaching] = useState(false);

  if (isTutor) {
    return (
      <div className="pop-in mx-auto max-w-lg py-12 text-center">
        <span className="paywall-dot">
          <Inbox />
        </span>
        <h2 className="paywall-title mt-6">No questions yet</h2>
        <Squiggle />
        <p className="mx-auto mt-4 max-w-md text-lg font-medium">
          When a student asks one, it lands here with the spec point or task they were on.
        </p>
        <button type="button" onClick={onAsk} className="btn-solid paywall-btn mt-7">
          New message <ArrowRight className="paywall-arrow size-5" />
        </button>
      </div>
    );
  }

  return (
    <div data-reaching={reaching} className="pop-in mx-auto max-w-lg py-12 text-center">
      <span className="paywall-dot inbox-dot">
        <MessageSquarePlus />
      </span>
      <h2 className="paywall-title mt-6">Stuck on something?</h2>
      <Squiggle />
      <p className="mx-auto mt-4 max-w-md text-lg font-medium">
        Ask your tutor. Attach the spec point, task or quiz and they&apos;ll see exactly what you
        mean.
      </p>
      <button
        type="button"
        data-guide="ask-question"
        onClick={onAsk}
        onPointerEnter={() => setReaching(true)}
        onPointerLeave={() => setReaching(false)}
        onFocus={() => setReaching(true)}
        onBlur={() => setReaching(false)}
        className="btn-solid paywall-btn mt-7"
      >
        Ask a question <ArrowRight className="paywall-arrow size-5" />
      </button>
    </div>
  );
}
