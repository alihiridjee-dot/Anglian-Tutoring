import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { PlanOverridesDAL } from "./planOverridesDal";
import { WeeklyPlanDAL } from "./weeklyPlanDal";
import { shiftKey } from "./breaks";
import { currentWeekKey } from "./week";

// The real client is built and `fetch` is stubbed below, so these only have to
// exist: without them the client throws on a machine with no local `.env`.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

const thisWeek = currentWeekKey();
const nextWeek = shiftKey(thisWeek, 7);
const course = { studentId: "student", subject: "biology", board: "aqa", level: "gcse" } as const;

/** What the stubbed `student_breaks` read answers: rows, or a failure. */
let breaks: { id: string }[] | "fails";
/** Every request that would change something, in order: "VERB name". */
let writes: string[];
/** The filters the break read was sent with. */
let breakFilters: URLSearchParams | null;
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let pinned: ReturnType<typeof spyOn<typeof WeeklyPlanDAL, "addToWeek">>;

beforeEach(() => {
  breaks = [];
  writes = [];
  breakFilters = null;
  pinned = spyOn(WeeklyPlanDAL, "addToWeek").mockResolvedValue();
  // Cast: Bun's `typeof fetch` also carries `preconnect`, which a mock has no use for.
  network = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const name = url.pathname.split("/").at(-1)!;
    const method = init?.method ?? "GET";
    if (name === "student_breaks") {
      breakFilters = url.searchParams;
      return breaks === "fails"
        ? new Response(JSON.stringify({ message: "timeout", code: "57014" }), { status: 500 })
        : new Response(JSON.stringify(breaks), { headers: { "Content-Type": "application/json" } });
    }
    writes.push(`${method} ${name}`);
    if (name === "remove_plan_point")
      return new Response(
        JSON.stringify({ removed: true, blocked: true, reason: null, origin: "core" }),
      );
    return new Response(null, { status: 204 });
  }) as typeof fetch);
});
afterEach(() => {
  network.mockRestore();
  pinned.mockRestore();
});

const move = (toWeek: string) =>
  PlanOverridesDAL.move({ ...course, specPointId: "p1", fromWeek: thisWeek, toWeek });

test("a move into a break week is refused before the point leaves its week", async () => {
  breaks = [{ id: "break" }];
  await expect(move(nextWeek)).rejects.toThrow("break week");
  expect(writes).toEqual([]);
  expect(pinned).not.toHaveBeenCalled();
  // The read asks for a break that stands and covers that Monday.
  expect(breakFilters?.get("student_id")).toBe("eq.student");
  expect(breakFilters?.get("cancelled_at")).toBe("is.null");
  expect(breakFilters?.get("starts_on")).toBe(`lte.${nextWeek}`);
  expect(breakFilters?.get("ends_on")).toBe(`gte.${nextWeek}`);
});

test("a move whose break check can't be read changes nothing", async () => {
  breaks = "fails";
  await expect(move(nextWeek)).rejects.toThrow();
  expect(writes).toEqual([]);
  expect(pinned).not.toHaveBeenCalled();
});

test("a move into an open week takes the point out, then pins it there", async () => {
  const result = await move(nextWeek);
  expect(result.removed).toBe(true);
  expect(writes).toEqual(["POST remove_plan_point", "DELETE student_plan_overrides"]);
  expect(pinned).toHaveBeenCalledTimes(1);
  expect(pinned.mock.calls[0][0]).toMatchObject({
    weekStart: nextWeek,
    specPointIds: ["p1"],
    origin: "tutor",
  });
});

test("a pin into a break week withdraws no removal and adds nothing", async () => {
  breaks = [{ id: "break" }];
  await expect(
    PlanOverridesDAL.pin({ ...course, weekStart: nextWeek, specPointIds: ["p1"] }),
  ).rejects.toThrow("break week");
  expect(writes).toEqual([]);
  expect(pinned).not.toHaveBeenCalled();
});
