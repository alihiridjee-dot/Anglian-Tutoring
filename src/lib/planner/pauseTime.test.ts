import { describe, expect, test } from "bun:test";
import { pausedMsSince } from "./pauseTime";

const day = 86_400_000;
const at = (d: string) => new Date(`${d}T12:00:00Z`);

describe("paused time since a review", () => {
  const now = at("2026-10-20");
  const pause = { start: at("2026-10-01"), end: at("2026-10-11") };

  test("a pause after the review stops its clock for the whole pause", () => {
    expect(pausedMsSince([pause], at("2026-09-20"), now)).toBe(10 * day);
  });
  test("a review during the pause only loses the rest of it", () => {
    expect(pausedMsSince([pause], at("2026-10-06"), now)).toBe(5 * day);
  });
  test("a review after the pause is untouched", () => {
    expect(pausedMsSince([pause], at("2026-10-12"), now)).toBe(0);
  });
  test("a pause still running counts up to now", () => {
    expect(pausedMsSince([{ start: at("2026-10-15"), end: null }], at("2026-09-20"), now)).toBe(
      5 * day,
    );
  });
  test("several pauses add up", () => {
    const spans = [pause, { start: at("2026-10-15"), end: at("2026-10-17") }];
    expect(pausedMsSince(spans, at("2026-09-20"), now)).toBe(12 * day);
  });
  test("a point never reviewed has no clock to stop", () => {
    expect(pausedMsSince([pause], undefined, now)).toBe(0);
  });
});
