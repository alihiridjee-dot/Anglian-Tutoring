import { Loader2, Repeat } from "lucide-react";
import { type ReviewMore } from "./useReviewMore";

/**
 * Under the week's lanes, when reviews are due but this week had no room for
 * them: how many are waiting, and the one control that brings the next batch in.
 */
export function ReviewMoreStrip({ more }: { more: ReviewMore }) {
  if (!more.available) return null;
  return (
    <div className="premium-card tint-rose rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-3 font-display font-bold">
        <span className="icon-tile size-9 shrink-0">
          <Repeat className="size-4" aria-hidden />
        </span>
        <span>
          <span className="numeral">{more.waiting}</span> more{" "}
          {more.waiting === 1 ? "review" : "reviews"} ready
        </span>
      </p>
      <button
        type="button"
        onClick={() => void more.pull()}
        disabled={more.busy}
        className="btn-soft h-11 sm:h-9 rounded-xl px-4 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
      >
        {more.busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Review {more.batch} more now
      </button>
    </div>
  );
}
