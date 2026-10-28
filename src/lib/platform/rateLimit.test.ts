import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { __resetRateLimitForTests, requestAddresses, retryWait, takeToken } from "./rateLimit";

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

describe("requestAddresses", () => {
  test("behind Cloudflare, counts the visitor, not Cloudflare's shared address", () => {
    const headers = new Headers({
      "x-forwarded-for": "172.70.1.2",
      "cf-connecting-ip": "81.2.69.160",
    });
    expect(requestAddresses(headers)).toEqual({ visitor: "81.2.69.160", hop: "172.70.1.2" });
  });

  test("without Cloudflare, the connecting address is both", () => {
    const headers = new Headers({ "x-forwarded-for": "81.2.69.160, 10.0.0.1" });
    expect(requestAddresses(headers)).toEqual({ visitor: "81.2.69.160", hop: "81.2.69.160" });
    expect(requestAddresses(new Headers({ "x-real-ip": "81.2.69.161" }))).toEqual({
      visitor: "81.2.69.161",
      hop: "81.2.69.161",
    });
  });

  test("with nothing to go on, everyone shares one bucket", () => {
    expect(requestAddresses(new Headers())).toEqual({ visitor: "unknown", hop: "unknown" });
    expect(requestAddresses(undefined)).toEqual({ visitor: "unknown", hop: "unknown" });
  });
});

describe("retryWait", () => {
  test("rounds up to whole minutes, never below one", () => {
    expect(retryWait(1)).toBe("1 minute");
    expect(retryWait(61)).toBe("2 minutes");
    expect(retryWait(600)).toBe("10 minutes");
  });
});
