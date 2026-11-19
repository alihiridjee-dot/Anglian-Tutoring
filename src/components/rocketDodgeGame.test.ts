import { describe, expect, test } from "bun:test";

import {
  LANES,
  ROCKET_Y,
  type Game,
  laneX,
  newGame,
  rowLanes,
  steer,
  step,
} from "./rocketDodgeGame";

const playing = (overrides: Partial<Game> = {}): Game => ({
  ...newGame("playing"),
  nextRow: 99,
  ...overrides,
});

/** Run the game for `seconds` in small frames. */
function run(game: Game, seconds: number, rand = () => 0.5) {
  for (let t = 0; t < seconds; t += 1 / 60) step(game, 1 / 60, rand);
}

describe("rocket dodge", () => {
  test("nothing moves until Play", () => {
    const game = newGame();
    step(game, 1);
    steer(game, -1);
    expect(game.time).toBe(0);
    expect(game.lane).toBe(1);
  });

  test("steering stops at the edges and the rocket slides there", () => {
    const game = playing();
    steer(game, -1);
    steer(game, -1);
    expect(game.lane).toBe(0);
    run(game, 0.3);
    expect(game.x).toBe(laneX(0));
    for (let i = 0; i < 5; i++) steer(game, 1);
    expect(game.lane).toBe(LANES - 1);
  });

  test("a rock in the rocket's lane ends the game", () => {
    const game = playing({ rocks: [{ id: 0, lane: 1, y: ROCKET_Y - 0.3, spin: 1, scale: 1 }] });
    run(game, 2);
    expect(game.status).toBe("over");
    expect(game.score).toBe(0);
  });

  test("a rock in another lane is dodged and scores", () => {
    const game = playing({ rocks: [{ id: 0, lane: 0, y: ROCKET_Y - 0.3, spin: 1, scale: 1 }] });
    run(game, 2);
    expect(game.status).toBe("playing");
    expect(game.score).toBe(1);
    expect(game.rocks).toHaveLength(0);
  });

  test("a row never blocks every lane", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 2000; i++) {
      const lanes = rowLanes(50, rand);
      expect(new Set(lanes).size).toBe(lanes.length);
      expect(lanes.length).toBeLessThan(LANES);
    }
  });

  test("a long frame counts as a short one", () => {
    const game = playing();
    step(game, 10);
    expect(game.time).toBeCloseTo(0.05);
  });
});
