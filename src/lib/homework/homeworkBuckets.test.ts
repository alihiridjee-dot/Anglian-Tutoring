import { describe, expect, test } from "bun:test";
import {
  bucketOf,
  groupHomework,
  isOverdue,
  splitDue,
  type HomeworkItem,
} from "@/lib/homework/homeworkBuckets";
import type { Homework } from "@/lib/homework/types";

const NOW = Date.parse("2026-11-20T12:00:00Z");

function brief(over: Partial<Homework> = {}): Homework {
  return {
    id: over.id ?? "hw-1",
    title: "Cell structure",
    instructions: null,
    subject: "biology",
    board: null,
    level: "GCSE_TRILOGY" as Homework["level"],
    due_at: null,
    created_at: "2026-09-01T09:00:00Z",
    origin: "tutor",
    ...over,
  };
}

describe("a brief due while the student was on a break", () => {
  // Away for the fortnight of 12 Oct 2026, back on Monday 26 Oct.
  const breaks = [
    {
      id: "b1",
      startsOn: "2026-10-12",
      endsOn: "2026-10-25",
      reason: "holiday" as const,
      recordedAt: null,
    },
  ];
  const joined = "2026-09-01T10:00:00Z";

  test("isn't due, and isn't Overdue", () => {
    const item: HomeworkItem = {
      hw: brief({ due_at: "2026-10-16T17:00:00Z" }),
      enrolledAt: joined,
      breaks,
    };
    expect(bucketOf(item)).toBeNull();
    expect(isOverdue(item, NOW)).toBe(false);
  });

  test("counts its UK date: late on the last Sunday is still in the break", () => {
    // 23:30 on Sunday 25 Oct in London is 23:30 UTC (BST has ended that day).
    const item: HomeworkItem = {
      hw: brief({ due_at: "2026-10-25T23:30:00Z" }),
      enrolledAt: joined,
      breaks,
    };
    expect(bucketOf(item)).toBeNull();
  });

  test("is still Overdue when it was due the day they were back", () => {
    const item: HomeworkItem = {
      hw: brief({ due_at: "2026-10-26T17:00:00Z" }),
      enrolledAt: joined,
      breaks,
    };
    expect(bucketOf(item)).toBe("due");
    expect(isOverdue(item, NOW)).toBe(true);
  });
});

describe("a brief set before the student joined", () => {
  // Briefs are visible by subject and level, not set per student, so a
  // student who joins in November also sees October's brief.
  const october = brief({ due_at: "2026-10-15T17:00:00Z" });

  test("isn't due, and isn't Overdue", () => {
    const item: HomeworkItem = { hw: october, enrolledAt: "2026-11-01T10:00:00Z" };
    expect(bucketOf(item)).toBeNull();
    expect(isOverdue(item, NOW)).toBe(false);
  });

  test("is still Overdue for a student who was here when it was due", () => {
    const item: HomeworkItem = { hw: october, enrolledAt: "2026-09-10T10:00:00Z" };
    expect(bucketOf(item)).toBe("due");
    expect(isOverdue(item, NOW)).toBe(true);
  });

  test("is due as before when the joining date isn't known", () => {
    expect(bucketOf({ hw: october })).toBe("due");
    expect(isOverdue({ hw: october }, NOW)).toBe(true);
  });

  test("due after they joined is due, even if it was set before", () => {
    const item: HomeworkItem = {
      hw: brief({ due_at: "2026-12-01T17:00:00Z" }),
      enrolledAt: "2026-11-01T10:00:00Z",
    };
    expect(bucketOf(item)).toBe("due");
    expect(isOverdue(item, NOW)).toBe(false);
  });
});

describe("a practice-queue sheet", () => {
  const sheet = (over: Partial<Homework> = {}) => brief({ origin: "generated", ...over });

  test("is due while its spec point is on this week's plan", () => {
    expect(bucketOf({ hw: sheet(), slot: { lane: "returning", order: 0 } })).toBe("due");
  });

  test("isn't shown when it is off this week's plan", () => {
    expect(bucketOf({ hw: sheet() })).toBeNull();
  });

  test("leaves Due once it is handed in, whatever its lane", () => {
    const submission = {
      id: "s1",
      resource_id: "hw-1",
      student_id: "u1",
      notes: null,
      submitted_at: "2026-11-19T10:00:00Z",
      score_pct: null,
      feedback: null,
      graded_at: null,
      acknowledged_at: null,
      release_at: null,
    };
    const item = { hw: sheet(), submission, slot: { lane: "new" as const, order: 0 } };
    expect(bucketOf(item)).toBe("submitted");
  });
});

describe("the Due tab", () => {
  test("follows the week's order, then a tutor's briefs by deadline, undated last", () => {
    const items: HomeworkItem[] = [
      { hw: brief({ id: "undated", title: "Undated brief" }) },
      { hw: brief({ id: "late", title: "Later brief", due_at: "2026-11-27T17:00:00Z" }) },
      { hw: brief({ id: "soon", title: "Sooner brief", due_at: "2026-11-21T17:00:00Z" }) },
      { hw: brief({ id: "rev", origin: "generated" }), slot: { lane: "revision", order: 2 } },
      { hw: brief({ id: "new", origin: "generated" }), slot: { lane: "new", order: 0 } },
      { hw: brief({ id: "back", origin: "generated" }), slot: { lane: "returning", order: 1 } },
    ];
    const [due] = groupHomework(items);
    expect(due.items.map((i) => i.hw.id)).toEqual([
      "new",
      "back",
      "rev",
      "soon",
      "late",
      "undated",
    ]);
    expect(splitDue(due.items).map((s) => [s.lane, s.items.map((i) => i.hw.id)])).toEqual([
      ["new", ["new"]],
      ["returning", ["back"]],
      ["revision", ["rev"]],
      ["tutor", ["soon", "late", "undated"]],
    ]);
  });

  test("spec point codes sort by number, so 4.1.1.2 comes before 4.1.1.10", () => {
    const items: HomeworkItem[] = [
      "4.1.1.10 Osmosis",
      "4.1.1.2 Animal cells",
      "4.1.1.9 Diffusion",
    ].map((title, i) => ({ hw: brief({ id: `hw-${i}`, title }) }));
    const [due] = groupHomework(items);
    expect(due.items.map((i) => i.hw.title)).toEqual([
      "4.1.1.2 Animal cells",
      "4.1.1.9 Diffusion",
      "4.1.1.10 Osmosis",
    ]);
  });
});
