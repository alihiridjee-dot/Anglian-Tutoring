import { describe, expect, test } from "bun:test";
import {
  JOIN_LEAD_MS,
  LIVE_TAIL_MS,
  MINUTE_MS,
  hasSessionFinished,
  nextSession,
  sessionStartMs,
  sessionTiming,
} from "./liveSessions";

const NOW = Date.parse("2026-09-21T16:00:00Z");
const at = (offsetMs: number) => ({ starts_at: new Date(NOW + offsetMs).toISOString() });

describe("sessionTiming", () => {
  test("a lesson that started two minutes ago is live and joinable, not finished", () => {
    const late = at(-2 * MINUTE_MS);
    const t = sessionTiming(sessionStartMs(late)!, NOW);
    expect(t.isLive).toBe(true);
    expect(t.joinable).toBe(true);
    expect(hasSessionFinished(late, NOW)).toBe(false);
  });

  test("the join window opens ten minutes before the start, and not earlier", () => {
    expect(sessionTiming(NOW + JOIN_LEAD_MS, NOW).joinable).toBe(true);
    expect(sessionTiming(NOW + JOIN_LEAD_MS + 1, NOW).joinable).toBe(false);
    expect(sessionTiming(NOW + JOIN_LEAD_MS + 1, NOW).withinDay).toBe(true);
  });

  test("it stops being live when the running window closes", () => {
    const ended = at(-LIVE_TAIL_MS);
    expect(sessionTiming(sessionStartMs(ended)!, NOW).isLive).toBe(false);
    expect(sessionTiming(sessionStartMs(ended)!, NOW).joinable).toBe(false);
    expect(hasSessionFinished(ended, NOW)).toBe(true);
    expect(hasSessionFinished(at(-LIVE_TAIL_MS + 1), NOW)).toBe(false);
  });
});

describe("nextSession", () => {
  test("prefers the lesson running now over one later today", () => {
    const running = { id: "a", ...at(-30 * MINUTE_MS) };
    const later = { id: "b", ...at(3 * 60 * MINUTE_MS) };
    expect(nextSession([later, running], NOW)?.id).toBe("a");
  });

  test("skips finished, undated and unparseable sessions", () => {
    const finished = { id: "old", ...at(-2 * LIVE_TAIL_MS) };
    const undated = { id: "none", starts_at: null };
    const garbage = { id: "bad", starts_at: "not a date" };
    const tomorrow = { id: "next", ...at(26 * 60 * MINUTE_MS) };
    expect(nextSession([finished, undated, garbage, tomorrow], NOW)?.id).toBe("next");
    expect(nextSession([finished, undated, garbage], NOW)).toBeNull();
    expect(hasSessionFinished(undated, NOW)).toBe(false);
  });
});
