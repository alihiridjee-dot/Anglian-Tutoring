import { describe, expect, test } from "bun:test";
import {
  bucketOf,
  groupHomework,
  isOverdue,
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

describe("a brief set before the student joined", () => {
  // Briefs are visible by subject and level, not set per student, so a
  // student who joins in November also sees October's brief.
  const october = brief({ due_at: "2026-10-15T17:00:00Z" });

  test("is practice, not Overdue", () => {
    const item: HomeworkItem = { hw: october, enrolledAt: "2026-11-01T10:00:00Z" };
    expect(bucketOf(item)).toBe("practice");
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

describe("practice order", () => {
  test("spec point codes sort by number, so 4.1.1.2 comes before 4.1.1.10", () => {
    const items: HomeworkItem[] = [
      "4.1.1.10 Osmosis",
      "4.1.1.2 Animal cells",
      "4.1.1.9 Diffusion",
    ].map((title, i) => ({ hw: brief({ id: `hw-${i}`, title }) }));
    const [practice] = groupHomework(items);
    expect(practice.items.map((i) => i.hw.title)).toEqual([
      "4.1.1.2 Animal cells",
      "4.1.1.9 Diffusion",
      "4.1.1.10 Osmosis",
    ]);
  });
});
