import { describe, expect, test } from "bun:test";
import {
  JOIN_LEAD_MS,
  LIVE_TAIL_MS,
  MINUTE_MS,
  hasSessionFinished,
  nextSession,
  sessionStartMs,
  sessionTiming,
  sessionsOnCourse,
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

describe("sessionsOnCourse", () => {
  const session = (id: string, subject: string, level: string, board: string | null) => ({
    id,
    subject,
    level,
    board,
  });
  const gcseBio = session("gcse-bio", "biology", "gcse", null);
  const alevelBio = session("alevel-bio", "biology", "alevel", null);
  const gcseBioAqa = session("gcse-bio-aqa", "biology", "gcse", "aqa");
  const gcseBioOcr = session("gcse-bio-ocr", "biology", "gcse", "ocr");
  const gcsePhys = session("gcse-phys", "physics", "gcse", null);
  const all = [gcseBio, alevelBio, gcseBioAqa, gcseBioOcr, gcsePhys];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  test("a GCSE student isn't shown an A-level room in the same subject", () => {
    const course = { level: "gcse", enrolments: [{ subject: "biology", board: "aqa" }] };
    expect(ids(sessionsOnCourse(all, course))).toEqual(["gcse-bio", "gcse-bio-aqa"]);
  });

  test("a session for another board is left out; one with no board is open to all", () => {
    const course = { level: "gcse", enrolments: [{ subject: "biology", board: "ocr" }] };
    expect(ids(sessionsOnCourse(all, course))).toEqual(["gcse-bio", "gcse-bio-ocr"]);
  });

  test("each subject is matched against its own board", () => {
    const course = {
      level: "gcse",
      enrolments: [
        { subject: "biology", board: "aqa" },
        { subject: "physics", board: "edexcel" },
      ],
    };
    expect(ids(sessionsOnCourse(all, course))).toEqual(["gcse-bio", "gcse-bio-aqa", "gcse-phys"]);
  });

  test("an A-level student sees only A-level sessions", () => {
    const course = { level: "alevel", enrolments: [{ subject: "biology", board: "aqa" }] };
    expect(ids(sessionsOnCourse(all, course))).toEqual(["alevel-bio"]);
  });

  test("a student with no level, or no enrolments, is shown nothing", () => {
    expect(
      sessionsOnCourse(all, { level: null, enrolments: [{ subject: "biology", board: "aqa" }] }),
    ).toEqual([]);
    expect(sessionsOnCourse(all, { level: "gcse", enrolments: [] })).toEqual([]);
  });
});
