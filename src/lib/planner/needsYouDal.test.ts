import { describe, expect, test } from "bun:test";
import type { StudentThread } from "@/lib/students/studentsDal";
import { needsFrom } from "./needsYouDal";

// The module builds the real client on import, which needs these to exist.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

const plan = (id: string, subject: string, week_start: string) => ({ id, subject, week_start });
const checkin = (
  plan_id: string,
  created_at: string,
  covered_ok: boolean | null,
  reflection: string | null = null,
) => ({ plan_id, covered_ok, reflection, created_at });
const thread = (id: string, last_message_at: string, about: string | null = null) =>
  ({
    id,
    subject_line: `Thread ${id}`,
    subject: null,
    status: "open",
    context_label: null,
    last_message_at,
    tutor_last_read_at: null,
    about_student_id: about,
  }) as StudentThread;

const base = {
  subject: "biology" as const,
  since: "2026-10-19",
  checkins: [],
  plans: [],
  answered: new Set<string>(),
  threads: [],
  summaries: [],
};

describe("what still needs a tutor", () => {
  test("a check-in asks for an answer when the student wanted more practice or wrote something", () => {
    const needs = needsFrom({
      ...base,
      plans: [
        plan("p1", "biology", "2026-11-16"),
        plan("p2", "biology", "2026-11-09"),
        plan("p3", "biology", "2026-11-02"),
      ],
      checkins: [
        checkin("p1", "2026-11-18T10:00:00Z", false, " I mix up the reflex arc. "),
        checkin("p2", "2026-11-12T10:00:00Z", true, "Went well"),
        // Finished, and nothing said: nothing to answer.
        checkin("p3", "2026-11-05T10:00:00Z", true),
      ],
    });
    expect(needs.map((n) => [n.id, n.kind, n.text, n.weekStart])).toEqual([
      ["checkin:p1", "checkin", "Wanted more practice. “I mix up the reflex arc.”", "2026-11-16"],
      ["checkin:p2", "checkin", "Felt confident to move on. “Went well”", "2026-11-09"],
    ]);
  });

  test("not one a tutor has filed a note against, another subject's, or an old week's", () => {
    const needs = needsFrom({
      ...base,
      plans: [
        plan("done", "biology", "2026-11-16"),
        plan("chem", "chemistry", "2026-11-16"),
        plan("old", "biology", "2026-10-12"),
      ],
      answered: new Set(["done"]),
      checkins: [
        checkin("done", "2026-11-18T10:00:00Z", false),
        checkin("chem", "2026-11-18T10:00:00Z", false),
        checkin("old", "2026-10-14T10:00:00Z", false),
        // Its plan row did not come back: nothing to file a note against.
        checkin("gone", "2026-11-18T10:00:00Z", false),
      ],
    });
    expect(needs).toEqual([]);
  });

  test("a thread counts while it has unread messages; a parent's is marked as such; newest first", () => {
    const needs = needsFrom({
      ...base,
      plans: [plan("p1", "biology", "2026-11-16")],
      checkins: [checkin("p1", "2026-11-18T10:00:00Z", false)],
      threads: [
        thread("read", "2026-11-19T08:00:00Z"),
        thread("mum", "2026-11-17T08:00:00Z", "student"),
        thread("new", "2026-11-19T12:00:00Z"),
      ],
      summaries: [
        { thread_id: "read", unread: 0, last_message: "Thanks!" },
        { thread_id: "mum", unread: 2, last_message: "Is he keeping up?" },
        { thread_id: "new", unread: 1, last_message: null },
      ],
    });
    expect(needs.map((n) => [n.id, n.kind, n.text])).toEqual([
      // With no message text to hand, the thread's own name stands in.
      ["thread:new", "message", "Thread new"],
      ["checkin:p1", "checkin", "Wanted more practice."],
      ["thread:mum", "parent", "Is he keeping up?"],
    ]);
  });
});
