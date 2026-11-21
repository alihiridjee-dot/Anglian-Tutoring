import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { PlanOverridesDAL } from "@/lib/planner/planOverridesDal";
import { BulkActions, describeOutcome, type BulkLine } from "./bulkActions";

// The DAL module builds the real client on import, which needs these to exist.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

const course = {
  studentId: "student",
  subject: "biology",
  board: "aqa",
  level: "gcse",
} as const;
const line = (code: string, week: string): BulkLine => ({ specPointId: `id-${code}`, code, week });
const removed = { removed: true, blocked: true, reason: null, origin: "core" } as const;
const worked = { removed: false, blocked: false, reason: "worked", origin: "core" } as const;

describe("acting on ticked lines across weeks", () => {
  const spies: { mockRestore: () => void }[] = [];
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  test("each line is removed from its own week, and a worked one is reported as staying", async () => {
    const remove = spyOn(PlanOverridesDAL, "remove").mockImplementation(async (p) =>
      p.specPointId === "id-5.2" ? worked : removed,
    );
    spies.push(remove);
    const outcome = await BulkActions.remove(course, [
      line("5.1", "2026-11-16"),
      line("5.2", "2026-11-16"),
      line("5.4", "2026-11-23"),
    ]);
    expect(remove.mock.calls.map(([p]) => [p.specPointId, p.weekStart])).toEqual([
      ["id-5.1", "2026-11-16"],
      ["id-5.2", "2026-11-16"],
      ["id-5.4", "2026-11-23"],
    ]);
    expect(outcome).toEqual({ done: ["5.1", "5.4"], worked: ["5.2"], failed: [] });
  });

  test("a move leaves a line already in the target week alone, and one failure doesn't stop the rest", async () => {
    const move = spyOn(PlanOverridesDAL, "move").mockImplementation(async (p) => {
      if (p.specPointId === "id-5.5") throw new Error("That's a break week.");
      return removed;
    });
    spies.push(move);
    const outcome = await BulkActions.move(
      course,
      [line("5.4", "2026-11-23"), line("5.5", "2026-11-16"), line("5.6", "2026-11-16")],
      "2026-11-23",
    );
    expect(move.mock.calls.map(([p]) => [p.specPointId, p.fromWeek, p.toWeek])).toEqual([
      ["id-5.5", "2026-11-16", "2026-11-23"],
      ["id-5.6", "2026-11-16", "2026-11-23"],
    ]);
    expect(outcome).toEqual({
      done: ["5.6"],
      worked: [],
      failed: [{ code: "5.5", reason: "That's a break week." }],
    });
  });

  test("a point ticked in two weeks is skipped once", async () => {
    const skip = spyOn(PlanOverridesDAL, "skip").mockResolvedValue({
      removed: 2,
      pinnedWeeks: [],
      workedWeeks: [],
    });
    spies.push(skip);
    const outcome = await BulkActions.skip(course, [
      line("1.3", "2026-11-16"),
      line("1.3", "2026-11-30"),
    ]);
    expect(skip).toHaveBeenCalledTimes(1);
    expect(outcome.done).toEqual(["1.3"]);
  });
});

describe("the outcome in words", () => {
  test("says what moved and where", () => {
    expect(
      describeOutcome(
        "Moved",
        { done: ["5.1", "5.3"], worked: [], failed: [] },
        "Sam",
        "to 23–29 Nov",
      ),
    ).toEqual({ ok: true, text: "Moved 5.1, 5.3 to 23–29 Nov." });
  });

  test("says what stayed because the student has worked on it", () => {
    expect(
      describeOutcome("Removed", { done: ["5.1"], worked: ["5.2"], failed: [] }, "Sam"),
    ).toEqual({
      ok: true,
      text: "Removed 5.1. Sam has already worked on 5.2, so it stays.",
    });
  });

  test("a failure is not reported as a success, and gives the database's reason", () => {
    const said = describeOutcome(
      "Removed",
      { done: [], worked: [], failed: [{ code: "5.5", reason: "Past weeks are history." }] },
      "Sam",
    );
    expect(said.ok).toBe(false);
    expect(said.text).toBe("Couldn't change 5.5: Past weeks are history.");
  });

  test("a long list is cut short", () => {
    expect(
      describeOutcome("Skipped", { done: ["1", "2", "3", "4", "5"], worked: [], failed: [] }, "Sam")
        .text,
    ).toBe("Skipped 1, 2, 3 and 2 more.");
  });
});
