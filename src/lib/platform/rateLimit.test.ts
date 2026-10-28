import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  __resetRateLimitForTests,
  requestAddresses,
  retryWait,
  takeToken,
  takeTokens,
} from "./rateLimit";

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

describe("takeTokens", () => {
  test("counts against every limit, or, when one is full, against none", () => {
    const visitor = { key: "wa:81.2.69.160", limit: 1, windowMs: 10 * MIN };
    const hop = { key: "wa-hop:172.70.1.2", limit: 2, windowMs: 10 * MIN };
    expect(takeTokens([visitor, hop]).ok).toBe(true);
    // The visitor is full, so the shared address isn't charged for the refusal.
    expect(takeTokens([visitor, hop]).ok).toBe(false);
    expect(takeTokens([visitor, hop]).ok).toBe(false);
    expect(takeToken(hop.key, hop.limit, hop.windowMs).ok).toBe(true);
    expect(takeToken(hop.key, hop.limit, hop.windowMs).ok).toBe(false);
  });

  test("a refused hit leaves no new key behind", () => {
    const hop = { key: "wa-hop:203.0.113.9", limit: 1, windowMs: 10 * MIN };
    expect(takeTokens([{ key: "wa:203.0.113.1", limit: 3, windowMs: 10 * MIN }, hop]).ok).toBe(
      true,
    );
    expect(takeTokens([{ key: "wa:203.0.113.2", limit: 3, windowMs: 10 * MIN }, hop]).ok).toBe(
      false,
    );
    // Had the refused visitor been recorded, a limit of 1 would refuse this.
    expect(takeToken("wa:203.0.113.2", 1, 10 * MIN).ok).toBe(true);
  });

  test("waits for the slowest full limit", () => {
    const start = new Date("2026-10-01T12:00:00Z").getTime();
    setSystemTime(start);
    takeTokens([{ key: "a", limit: 1, windowMs: 10 * MIN }]);
    takeTokens([{ key: "b", limit: 1, windowMs: 60 * MIN }]);
    const refused = takeTokens([
      { key: "a", limit: 1, windowMs: 10 * MIN },
      { key: "b", limit: 1, windowMs: 60 * MIN },
    ]);
    expect(refused.retryAfter).toBe(60 * 60);
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

  test("a visitor value that isn't an address is ignored", () => {
    for (const claimed of [
      "__global__",
      "hop:172.70.1.2",
      "x".repeat(4096),
      "1.2.3.256",
      "1::2::3",
    ]) {
      const headers = new Headers({ "x-forwarded-for": "172.70.1.2", "cf-connecting-ip": claimed });
      expect(requestAddresses(headers)).toEqual({ visitor: "172.70.1.2", hop: "172.70.1.2" });
    }
  });

  test("the hourly budget can't be reached through the visitor's address", () => {
    const start = new Date("2026-10-01T12:00:00Z").getTime();
    setSystemTime(start);
    expect(takeToken("__global__", 2, 60 * MIN).ok).toBe(true);
    expect(takeToken("__global__", 2, 60 * MIN).ok).toBe(true);

    setSystemTime(start + 15 * MIN);
    const { visitor, hop } = requestAddresses(
      new Headers({ "x-forwarded-for": "172.70.1.2", "cf-connecting-ip": "__global__" }),
    );
    takeTokens([
      { key: `wa:${visitor}`, limit: 3, windowMs: 10 * MIN },
      { key: `wa-hop:${hop}`, limit: 30, windowMs: 10 * MIN },
    ]);
    // Still spent: the hour isn't up.
    expect(takeToken("__global__", 2, 60 * MIN).ok).toBe(false);
  });

  test("an IPv6 visitor counts as their /64", () => {
    const at = (ip: string) =>
      requestAddresses(new Headers({ "x-forwarded-for": "172.70.1.2", "cf-connecting-ip": ip }))
        .visitor;
    expect(at("2a00:23c8:1a2b:3c00:1111:2222:3333:4444")).toBe("2a00:23c8:1a2b:3c00::/64");
    expect(at("2A00:23C8:1A2B:3C00::9")).toBe("2a00:23c8:1a2b:3c00::/64");
    expect(at("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(at("2001:0db8:0000:0001:0:0:0:1")).toBe("2001:db8:0:1::/64");
    expect(at("::1")).toBe("0:0:0:0::/64");
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
