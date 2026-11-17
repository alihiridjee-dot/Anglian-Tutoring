/**
 * Rocket dodge: a small game in the 404 card, so a wrong turn isn't a dead end.
 *
 * The rules live in `rocketDodgeGame.ts`; this file draws them. The best score is
 * kept in this browser only — nothing is sent anywhere, and nothing here needs
 * a session.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Mascot } from "@/components/Doodles";
import { cn } from "@/lib/utils";

import { type Game, ROCKET_Y, laneX, newGame, steer, step } from "./rocketDodgeGame";

const BEST_KEY = "rocket-dodge-best";
/** A crash ignores Space for a moment, so a held key doesn't skip the result. */
const RESTART_PAUSE_MS = 600;

/** Fixed, so the server render and the first client render agree. */
const STARS = [
  [0.08, 0.12],
  [0.27, 0.33],
  [0.44, 0.07],
  [0.63, 0.24],
  [0.86, 0.15],
  [0.15, 0.58],
  [0.36, 0.71],
  [0.58, 0.49],
  [0.79, 0.66],
  [0.93, 0.41],
  [0.21, 0.88],
  [0.71, 0.92],
] as const;

function readBest() {
  try {
    return Number(window.localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(score: number) {
  try {
    window.localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // Private window or blocked storage: the best score just isn't kept.
  }
}

function Asteroid({ spin }: { spin: 1 | -1 }) {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden
      className={cn(
        "tint-slate h-auto w-full text-[color:var(--foreground)]",
        spin === 1 ? "rocket-dodge-spin" : "rocket-dodge-spin-back",
      )}
    >
      <g stroke="currentColor" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round">
        <path
          d="M58 10c18-2 34 8 44 22 10 14 10 34 2 50-8 16-26 28-46 28-20 0-36-10-44-26C6 68 8 48 18 34 26 20 40 12 58 10Z"
          fill="color-mix(in oklab, var(--tint) 26%, white)"
        />
        <circle cx={44} cy={44} r={11} fill="color-mix(in oklab, var(--tint) 55%, white)" />
        <circle cx={76} cy={70} r={8} fill="color-mix(in oklab, var(--tint) 55%, white)" />
        <circle cx={46} cy={82} r={5} fill="color-mix(in oklab, var(--tint) 55%, white)" />
      </g>
    </svg>
  );
}

export function RocketDodge() {
  const game = useRef<Game>(newGame());
  const crashedAt = useRef(0);
  const [, redraw] = useState(0);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);

  useEffect(() => setBest(readBest()), []);

  const start = useCallback(() => {
    if (game.current.status === "playing") return;
    if (Date.now() - crashedAt.current < RESTART_PAUSE_MS) return;
    game.current = newGame("playing");
    setNewBest(false);
    redraw((n) => n + 1);
  }, []);

  const move = useCallback((direction: -1 | 1) => {
    steer(game.current, direction);
    redraw((n) => n + 1);
  }, []);

  const status = game.current.status;

  // The loop runs only while a game is on, so an idle 404 page costs nothing.
  useEffect(() => {
    if (status !== "playing") return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      step(game.current, (now - last) / 1000);
      last = now;
      if (game.current.status === "over") {
        crashedAt.current = Date.now();
        const score = game.current.score;
        const previous = readBest();
        if (score > previous) {
          saveBest(score);
          setBest(score);
          setNewBest(true);
        }
        redraw((n) => n + 1);
        return;
      }
      redraw((n) => n + 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [status]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a, button, input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if (game.current.status === "playing") {
        if (key === "arrowleft" || key === "a") move(-1);
        else if (key === "arrowright" || key === "d") move(1);
        else return;
        event.preventDefault();
      } else if (key === " " || key === "enter") {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, start]);

  const g = game.current;
  // Leans into a lane change while it slides across.
  const tilt = Math.max(-18, Math.min(18, (laneX(g.lane) - g.x) * 270));
  const starDrift = g.time * 0.18;

  return (
    <div
      role="group"
      aria-label="Rocket dodge game"
      className="rocket-dodge tint-accent relative mx-auto aspect-[4/5] w-full max-w-[18rem] touch-none overflow-hidden rounded-2xl select-none short:max-w-[11rem]"
      onPointerDown={(event) => {
        if (g.status !== "playing") return;
        const box = event.currentTarget.getBoundingClientRect();
        move(event.clientX - box.left < box.width / 2 ? -1 : 1);
      }}
    >
      {STARS.map(([x, y], i) => (
        <span
          key={i}
          aria-hidden
          className="rocket-dodge-star"
          style={{ left: `${x * 100}%`, top: `${((y + starDrift) % 1) * 100}%` }}
        />
      ))}

      {g.rocks.map((rock) => (
        <div
          key={rock.id}
          className="absolute w-[17%] -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${laneX(rock.lane) * 100}%`,
            top: `${rock.y * 100}%`,
            scale: rock.scale,
          }}
        >
          <Asteroid spin={rock.spin} />
        </div>
      ))}

      <div
        className={cn(
          "absolute w-[24%] -translate-x-1/2 -translate-y-1/2",
          g.status === "over" && "rocket-dodge-crash",
        )}
        style={{
          left: `${g.x * 100}%`,
          top: `${ROCKET_Y * 100}%`,
          rotate: `${g.status === "playing" ? tilt : 0}deg`,
        }}
      >
        <Mascot
          name="rocket"
          mood={g.status === "over" ? (newBest ? "proud" : "wow") : "happy"}
          idle={g.status === "ready"}
          className="h-auto w-full"
        />
      </div>

      {g.status === "playing" ? (
        <p className="numeral absolute inset-x-0 top-3 text-center text-3xl text-[color:var(--foreground)]">
          {g.score}
        </p>
      ) : (
        <div className="absolute inset-x-0 top-0 flex flex-col items-center px-4 pt-6 text-center short:pt-3">
          {g.status === "over" ? (
            <>
              <p className="text-foreground text-base font-bold">
                {newBest ? "New best!" : "Crashed!"}
              </p>
              <p className="numeral text-5xl text-[color:var(--foreground)] short:text-3xl">
                {g.score}
              </p>
            </>
          ) : (
            <p className="text-foreground text-base font-bold">Dodge the asteroids</p>
          )}
          <button
            type="button"
            onClick={start}
            className="btn-solid mt-3 inline-flex min-h-11 items-center rounded-xl px-5 text-sm"
          >
            {g.status === "over" ? "Play again" : "Play"}
          </button>
          <p className="text-foreground mt-3 text-sm font-semibold">
            {best > 0 ? `Best ${best} · ` : ""}← → or tap a side
          </p>
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {g.status === "over" ? `Crashed. You dodged ${g.score}. Best ${best}.` : ""}
      </p>
    </div>
  );
}
