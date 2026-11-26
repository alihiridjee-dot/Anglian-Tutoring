import type { CSSProperties, ReactNode } from "react";
import { useEntryState } from "@/hooks/useEntryState";

export interface BillingStop {
  key: string;
  emoji: string;
  name: string;
  /** One word or two under the name: "Active", "Two on your plan". */
  word?: string;
  /** The stop's colour, and the card's when it is open. */
  tint: string;
  /** What opens in the one card underneath. */
  body: ReactNode;
}

/** The dotted line between the first stop and the last, one wave per gap. */
function TrailPath({ gaps }: { gaps: number }) {
  let d = "M0 20";
  for (let i = 0; i < gaps; i++) {
    const x = i * 100;
    const [up, down] = i % 2 ? [36, 4] : [4, 36];
    d += ` C${x + 30} ${up} ${x + 70} ${down} ${x + 100} 20`;
  }
  return (
    <svg
      aria-hidden
      className="point-trail-path"
      viewBox={`0 0 ${gaps * 100} 40`}
      preserveAspectRatio="none"
    >
      <path d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Billing as a trail (Ali picked it, 26 Nov 2026): Subjects → Plan → Payments
 * → Break as round stops on a dotted line, and the picked stop opens in one
 * card underneath — the spec point page's pattern (README, "A page of work is
 * a trail"), on the same `point-*` pieces. The caller leaves out a stop with
 * nothing behind it.
 *
 * The open stop is kept with the visit, so Back from the Stripe portal or a
 * receipt lands on the stop that was left.
 */
export function BillingTrail({ stops, initial }: { stops: BillingStop[]; initial?: string }) {
  const [picked, setPicked] = useEntryState<string | null>("billing-stop", null);
  const active =
    stops.find((s) => s.key === picked) ?? stops.find((s) => s.key === initial) ?? stops[0];
  if (!active) return null;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Billing"
        className="point-trail"
        style={{ "--stops": stops.length } as CSSProperties}
      >
        {stops.length > 1 && <TrailPath gaps={stops.length - 1} />}
        {stops.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            id={`billing-stop-${s.key}`}
            aria-selected={s.key === active.key}
            aria-controls="billing-panel"
            onClick={() => setPicked(s.key)}
            className={`point-stop ${s.tint}`}
          >
            <span className="point-stop-dot">
              <span aria-hidden>{s.emoji}</span>
            </span>
            <span className="point-stop-label">{s.name}</span>
            {s.word && <span className="point-stop-word">{s.word}</span>}
          </button>
        ))}
      </div>

      <div
        key={active.key}
        id="billing-panel"
        role="tabpanel"
        aria-labelledby={`billing-stop-${active.key}`}
        className={`point-panel premium-card ${active.tint} rounded-2xl p-2 sm:p-4`}
      >
        {active.body}
      </div>
    </div>
  );
}
