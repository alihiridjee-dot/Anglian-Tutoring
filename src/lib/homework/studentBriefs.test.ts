import { expect, test } from "bun:test";
import { readStudentBriefs, sortBriefs } from "./studentBriefs";
import type { Homework } from "./types";

const brief = (id: string, due_at: string | null): Homework => ({
  id,
  title: id,
  instructions: null,
  subject: "physics",
  board: null,
  level: "gcse",
  due_at,
  created_at: "2026-11-01T00:00:00+00:00",
  origin: "generated",
});

test("reads every page past the 1,000-row cap, then stops on an empty page", async () => {
  // 1,200 rows in three pages: 500, 500, then a short 200.
  const source = Array.from({ length: 1200 }, (_, i) => brief(String(i).padStart(5, "0"), null));
  const asked: (string | null)[] = [];
  const rows = await readStudentBriefs(async (after) => {
    asked.push(after);
    const rest = source.filter((r) => after === null || r.id > after);
    return { data: rest.slice(0, 500), error: null };
  });
  expect(rows).toHaveLength(1200);
  expect(new Set(rows.map((r) => r.id)).size).toBe(1200);
  expect(asked).toEqual([null, "00499", "00999", "01199"]);
});

test("a failed page fails the whole read rather than showing part of the list", async () => {
  await expect(
    readStudentBriefs(async (after) =>
      after
        ? { data: null, error: { message: "Connection lost" } }
        : { data: [brief("a", null)], error: null },
    ),
  ).rejects.toThrow("Connection lost");
});

test("orders by due date, undated last, with id breaking ties", () => {
  const rows = sortBriefs([
    brief("d", null),
    brief("c", "2026-11-20T09:00:00+00:00"),
    brief("b", null),
    brief("e", "2026-11-19T09:00:00+00:00"),
    brief("a", "2026-11-20T09:00:00+00:00"),
  ]);
  expect(rows.map((r) => r.id)).toEqual(["e", "a", "c", "b", "d"]);
});
