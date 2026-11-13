import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";

export interface RoadStop {
  id: string;
  emoji: string;
  /** The word on the signpost: what this part of the week does. */
  sign: string;
  title: string;
  body: string;
  points: string[];
  preview: () => React.JSX.Element;
  tint: string;
  /** Give the preview more width: for mocks too detailed for the narrow one. */
  wide?: boolean;
}

/** Each preview leans a little, alternately, so the set doesn't look stamped out. */
const TILT = ["-2deg", "2deg", "-1.5deg", "1.5deg", "-2deg", "1deg"];

/**
 * The week as a road (11 Nov 2026, option B of Ali's How it works mockups). On a
 * wide, tall enough screen the section holds still while you scroll, and the
 * stops drive past sideways under a backpack that stays put. The stop at the
 * backpack is lit in its colour; the one leaving and the one arriving crossfade,
 * the cards drift a little faster than the words and tip as they come and go,
 * and the signposts sway as they pass. Anywhere else the stops simply stack.
 *
 * The scroll sets where the road should be; the road glides there rather than
 * jumping with each notch of the wheel, and it lingers at each stop. Everything
 * is written straight onto the elements (`--glow`, `--d`), so a frame re-renders
 * nothing unless the stop at the backpack changes.
 */
export function FeatureRoad({ stops }: { stops: RoadStop[] }) {
  const pinRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const riderRef = useRef<HTMLDivElement>(null);
  const stopRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const last = stops.length - 1;

  useEffect(() => {
    const road = window.matchMedia("(width >= 64rem) and (height >= 42rem)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let target = 0;
    let shown = 0;
    let frame = 0;
    let then = 0;

    /** How far along the road the scroll says we are: 2.5 is halfway from the
     * third stop to the fourth. Eased within each leg, so the road slows into
     * each stop and speeds up between them, but never quite stops moving. */
    const wanted = () => {
      const pin = pinRef.current;
      if (!pin) return 0;
      const bar = pin.getBoundingClientRect();
      const run = pin.offsetHeight - window.innerHeight;
      const raw = (Math.min(1, Math.max(0, -bar.top / run)) || 0) * last;
      const k = Math.min(last - 1, Math.floor(raw));
      const f = raw - k;
      return k + f * 0.35 + f * f * (3 - 2 * f) * 0.65;
    };

    const roll = (at: number) => {
      const width = stopRefs.current[0]?.offsetWidth ?? 0;
      if (trackRef.current) trackRef.current.style.transform = `translateX(${-at * width}px)`;
      stopRefs.current.forEach((stop, j) => {
        const d = j - at;
        // The stop leaving and the one arriving pass each other at half glow,
        // so there is never a moment with nothing lit.
        const glow = 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, Math.abs(d)));
        stop?.style.setProperty("--glow", glow.toFixed(3));
        stop?.style.setProperty("--d", Math.max(-1.5, Math.min(1.5, d)).toFixed(3));
      });
      setActive(Math.round(at));
    };

    // Chases the target, about a third of a second behind. Timed by the clock,
    // not by frames, so a 120 Hz screen feels the same as a 60 Hz one.
    const glide = (now: number) => {
      frame = 0;
      const dt = Math.min(64, now - then);
      then = now;
      const step = (target - shown) * (1 - Math.exp(-dt / 140));
      shown = Math.abs(target - shown) < 0.0008 ? target : shown + step;
      roll(shown);
      // The backpack trots while the road moves, leaning into the speed.
      const rider = riderRef.current;
      rider?.toggleAttribute("data-moving", Math.abs(step) > 0.0015);
      rider?.style.setProperty(
        "--lean",
        `${Math.max(-12, Math.min(12, step * 400)).toFixed(1)}deg`,
      );
      if (shown !== target) frame = requestAnimationFrame(glide);
    };

    const drive = () => {
      if (!road.matches) {
        // Stacked: nothing moves, so clear what the road wrote.
        cancelAnimationFrame(frame);
        frame = 0;
        if (trackRef.current) trackRef.current.style.transform = "";
        return;
      }
      target = wanted();
      if (still.matches) {
        shown = target;
        roll(shown);
      } else if (!frame) {
        then = performance.now();
        frame = requestAnimationFrame(glide);
      }
    };

    // Arriving mid-road (a reload, a link back) starts where the scroll is,
    // rather than driving there from the first stop.
    if (road.matches) {
      shown = target = wanted();
      roll(shown);
    }
    window.addEventListener("scroll", drive, { passive: true });
    window.addEventListener("resize", drive);
    road.addEventListener("change", drive);
    return () => {
      window.removeEventListener("scroll", drive);
      window.removeEventListener("resize", drive);
      road.removeEventListener("change", drive);
      cancelAnimationFrame(frame);
    };
  }, [last]);

  /** Scrolls to the point where stop `i` sits at the backpack. */
  const jumpTo = (i: number) => {
    const pin = pinRef.current;
    if (!pin) return;
    const run = pin.offsetHeight - window.innerHeight;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: pin.getBoundingClientRect().top + window.scrollY + (run * i) / last,
      behavior: still ? "auto" : "smooth",
    });
  };

  return (
    <div ref={pinRef} className="road" style={{ "--stops": stops.length } as CSSProperties}>
      <div className="road-frame">
        <div ref={trackRef} className="road-track">
          <svg
            className="road-tarmac"
            viewBox={`0 0 ${stops.length * 1000} 96`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <path className="tar" d={roadPath(stops.length)} />
            <path className="lines" d={roadPath(stops.length)} />
          </svg>
          <ol className="road-stops">
            {stops.map((s, i) => {
              const Preview = s.preview;
              return (
                <li
                  key={s.id}
                  ref={(el) => {
                    stopRefs.current[i] = el;
                  }}
                  data-active={i === active || undefined}
                  className={`road-stop ${s.tint}`}
                >
                  <p className="road-sign">
                    <b>{s.sign}</b>
                    <i aria-hidden />
                  </p>
                  <div className="road-text">
                    <span aria-hidden className="road-emoji">
                      {s.emoji}
                    </span>
                    <h3 className="text-foreground mt-3 text-3xl font-extrabold">{s.title}</h3>
                    <p className="text-muted-foreground mt-3 text-[1.0625rem] leading-relaxed">
                      {s.body}
                    </p>
                    <ul className="mt-5 grid gap-2.5">
                      {s.points.map((pt) => (
                        <li
                          key={pt}
                          className="text-foreground flex items-start gap-2.5 text-[0.97rem] font-semibold"
                        >
                          <Check className="road-tick mt-0.5 size-4 shrink-0" aria-hidden />
                          {pt}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div
                    className={`road-shot ${s.wide ? "is-wide" : ""}`}
                    style={{ "--r": TILT[i % TILT.length] } as CSSProperties}
                  >
                    <Preview />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div ref={riderRef} className="road-rider" aria-hidden>
          <span>🎒</span>
        </div>
        <nav className="road-dots" aria-label="Parts of the week">
          {stops.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={s.title}
              aria-current={i === active ? "step" : undefined}
              onClick={() => jumpTo(i)}
            >
              <span aria-hidden>{s.emoji}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** A gently winding road, two bends per stop, drawn across the whole track.
 * About 1,000 units a stop, so the stretch to the track's width stays slight. */
function roadPath(stops: number) {
  const bends = stops * 2;
  const leg = 500;
  let d = "M0 48";
  for (let i = 0; i < bends; i++) {
    d += ` Q ${(i + 0.5) * leg} ${i % 2 ? 70 : 26}, ${(i + 1) * leg} 48`;
  }
  return d;
}
