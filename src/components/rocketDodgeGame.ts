/**
 * Rocket dodge, the game on the 404 page: the rules, with no React in them.
 *
 * Everything is measured as a fraction of the play field (x across, y down),
 * so the same game plays the same on a phone and a desktop. The rocket sits
 * near the bottom in one of three lanes; rows of asteroids fall towards it and
 * a row never fills every lane, so there is always a way through.
 */

export const LANES = 3;
/** Where the rocket's centre sits, down the field. */
export const ROCKET_Y = 0.8;
/** How close (across) a rock's centre may come to the rocket's before it hits. */
export const HIT_X = 0.13;
/** How close (down) a rock's centre may come to the rocket's before it hits. */
export const HIT_Y = 0.09;
/** Rocks start just above the field and are dropped once they leave it. */
const ROCK_START_Y = -0.1;
const ROCK_GONE_Y = 1.15;
/** Field widths a second the rocket slides when it changes lane. */
const ROCKET_SLIDE = 4;
/** A long frame (a background tab, a slow phone) counts as this, at most. */
const MAX_STEP = 0.05;

export type Rock = { id: number; lane: number; y: number; spin: 1 | -1; scale: number };

export type Game = {
  status: "ready" | "playing" | "over";
  /** The lane the rocket is heading for. */
  lane: number;
  /** Where the rocket is now; it slides towards its lane rather than jumping. */
  x: number;
  rocks: Rock[];
  /** Rocks that have fallen past the rocket. */
  score: number;
  /** Seconds played, which also scrolls the stars. */
  time: number;
  /** Seconds until the next row drops. */
  nextRow: number;
  nextId: number;
};

export const laneX = (lane: number) => (lane + 0.5) / LANES;

export function newGame(status: Game["status"] = "ready"): Game {
  const middle = Math.floor(LANES / 2);
  return {
    status,
    lane: middle,
    x: laneX(middle),
    rocks: [],
    score: 0,
    time: 0,
    nextRow: 0.6,
    nextId: 0,
  };
}

/** Field heights a second the rocks fall: faster the longer you last. */
export const fallSpeed = (score: number) => Math.min(1.25, 0.42 + score * 0.025);

/** Seconds between rows: closer together the longer you last. */
export const rowGap = (score: number) => Math.max(0.42, 0.95 - score * 0.018);

/** Steer one lane left (-1) or right (1). Does nothing unless a game is on. */
export function steer(game: Game, direction: -1 | 1) {
  if (game.status !== "playing") return;
  game.lane = Math.min(LANES - 1, Math.max(0, game.lane + direction));
}

/** Which lanes the next row blocks: one, or two once you're good. Never all. */
export function rowLanes(score: number, rand: () => number): number[] {
  const first = Math.floor(rand() * LANES);
  if (score < 12 || rand() >= 0.35) return [first];
  const second = (first + 1 + Math.floor(rand() * (LANES - 1))) % LANES;
  return [first, second];
}

/** Move the game on by `seconds`. Changes `game` in place. */
export function step(game: Game, seconds: number, rand: () => number = Math.random) {
  if (game.status !== "playing") return;
  const dt = Math.min(Math.max(seconds, 0), MAX_STEP);
  game.time += dt;

  const target = laneX(game.lane);
  const slide = ROCKET_SLIDE * dt;
  game.x =
    Math.abs(target - game.x) <= slide ? target : game.x + Math.sign(target - game.x) * slide;

  const fall = fallSpeed(game.score) * dt;
  const kept: Rock[] = [];
  for (const rock of game.rocks) {
    const wasAbove = rock.y <= ROCKET_Y + HIT_Y;
    rock.y += fall;
    if (Math.abs(rock.y - ROCKET_Y) < HIT_Y && Math.abs(laneX(rock.lane) - game.x) < HIT_X) {
      game.status = "over";
    }
    if (wasAbove && rock.y > ROCKET_Y + HIT_Y) game.score += 1;
    if (rock.y < ROCK_GONE_Y) kept.push(rock);
  }
  game.rocks = kept;
  if (game.status === "over") return;

  game.nextRow -= dt;
  if (game.nextRow <= 0) {
    for (const lane of rowLanes(game.score, rand)) {
      game.rocks.push({
        id: game.nextId++,
        lane,
        y: ROCK_START_Y,
        spin: rand() < 0.5 ? -1 : 1,
        scale: 0.85 + rand() * 0.3,
      });
    }
    game.nextRow = rowGap(game.score);
  }
}
