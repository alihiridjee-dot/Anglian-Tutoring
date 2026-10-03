import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { __resetRateLimitForTests, takeToken } from "./rateLimit";

const MIN = 60_000;

afterEach(() => {
  setSystemTime();
  __resetRateLimitForTests();
});

describe("takeToken", () => {
  test("allows up to the limit in a window, then refuses", () => {
    expect(takeToken("ip-a", 2, 10 * MIN).ok).toBe(true);
    expect(takeToken("ip-a", 2, 10 * MIN).ok).toBe(true);
    const third = takeToken("ip-a", 2, 10 * MIN);
    expect(third.ok).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
  });

  test("a sweep run by a short-window caller keeps a long window's hits", () => {
    const start = new Date("2026-10-01T12:00:00Z").getTime();
    setSystemTime(start);
    // The hour-long WhatsApp budget, used up.
    expect(takeToken("__global__", 1, 60 * MIN).ok).toBe(true);

    // Eleven minutes later, contact-form traffic on a 10-minute window runs
    // enough writes to trigger a sweep.
    setSystemTime(start + 11 * MIN);
    for (let i = 0; i < 500; i++) takeToken(`contact:ip-${i}`, 4, 10 * MIN);

    // The hour isn't up, so the budget is still spent.
    expect(takeToken("__global__", 1, 60 * MIN).ok).toBe(false);
  });
});
