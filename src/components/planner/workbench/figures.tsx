import { CircleAlert } from "lucide-react";
import { Ring } from "@/components/Shared";
import { STATUS_STYLE, STRONG_THRESHOLD, type PointStatus } from "@/lib/planner/coverage";
import { cn } from "@/lib/utils";

/**
 * How the tutor's workbench shows a figure. Ali's two rules (Nov 2026): no
 * loose numbers, and no pills. So a number is never bare beside a word and
 * never wrapped in a capsule with it: it sits inside the bullet itself.
 */

/** The colour an action or a heading takes from the tint around it. */
export const TINT_TEXT = "text-[color:color-mix(in_oklab,var(--tint)_72%,var(--primary-deep))]";

/**
 * A count: the number inside a round dot in the colour of what it counts, the
 * plain word beside it.
 */
export function Tally({ n, word, tint }: { n: number; word: string; tint?: string }) {
  return (
    <span className={cn(tint, "inline-flex items-center gap-1.5 whitespace-nowrap")}>
      <span
        className={cn(
          "numeral grid h-6 min-w-6 place-items-center rounded-full bg-[color-mix(in_oklab,var(--tint)_22%,var(--card))] px-1.5 text-xs",
          TINT_TEXT,
        )}
      >
        {n}
      </span>
      {word}
    </span>
  );
}

/**
 * A mark out of 100: a ring filled as far as the mark with the figure inside.
 * Green from the "nailed it" line, amber below it, so a low mark is seen before
 * the number is read.
 */
export function Mark({ value }: { value: number }) {
  const shown = Math.round(value);
  return (
    <Ring
      value={shown}
      size={32}
      stroke={3.5}
      className={cn("align-middle", shown >= STRONG_THRESHOLD ? "tint-emerald" : "tint-amber")}
    >
      <span className="numeral text-xs">
        {shown}
        <span className="sr-only">%</span>
      </span>
    </Ring>
  );
}

/** A task or a quiz on one point: its mark, or where it stands in words. */
export type Work = { mark: number } | { text: string } | null;

export function WorkCell({ work }: { work: Work }) {
  if (!work) return null;
  return "mark" in work ? <Mark value={work.mark} /> : <>{work.text}</>;
}

/**
 * How a point is going: a dot in the status's colour and the word. A point due
 * in a week gone by and never started is "Missed", with its own mark, so it is
 * not read as one more "Not done".
 */
export function StatusWord({ status, missed }: { status: PointStatus | null; missed?: boolean }) {
  if (missed)
    return (
      <b className={cn("tint-rose inline-flex items-center gap-1.5 whitespace-nowrap", TINT_TEXT)}>
        <CircleAlert className="size-4" aria-hidden />
        Missed
      </b>
    );
  if (!status) return null;
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn("size-2.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

/** A control: small on a laptop, a full tap target on a touch screen. */
export const CTRL =
  "btn-soft inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-sm whitespace-nowrap disabled:opacity-50 sm:pointer-fine:min-h-8";
/** An action in a line of text: no outline, so a list of them stays quiet. */
export const QUIET = cn(
  "btn-ghost inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-bold disabled:opacity-50 sm:pointer-fine:min-h-8",
  "text-[color:color-mix(in_oklab,var(--tint)_72%,var(--primary-deep))]!",
);
export const FIELD = "premium-input min-h-11 rounded-lg! px-2 text-sm sm:pointer-fine:min-h-8";
export const SOLID =
  "btn-solid inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm disabled:opacity-50 sm:pointer-fine:min-h-8";
