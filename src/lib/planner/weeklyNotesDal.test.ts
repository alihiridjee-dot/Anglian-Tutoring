import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { WeeklyNotesDAL } from "./weeklyNotesDal";
import * as session from "../auth/session";

// S-31: a failed read of the check-in or the tutor's note used to come back as
// "none", and the next save wrote over the real one.
let failing: boolean;
let writes: { name: string; body: Record<string, unknown> }[];
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let viewer: ReturnType<typeof spyOn<typeof session, "getSessionUserId">>;

beforeEach(() => {
  failing = false;
  writes = [];
  viewer = spyOn(session, "getSessionUserId").mockResolvedValue("student");
  // Cast: Bun's `typeof fetch` also carries `preconnect`, which a mock has no use for.
  network = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const name = url.pathname.split("/").at(-1)!;
    if (init?.method === "POST") {
      writes.push({ name, body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 201 });
    }
    if (failing)
      return new Response(JSON.stringify({ message: "canceling statement", code: "57014" }), {
        status: 500,
      });
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
});
afterEach(() => {
  network.mockRestore();
  viewer.mockRestore();
});

test("a failed read throws instead of reading as 'no note'", async () => {
  failing = true;
  await expect(WeeklyNotesDAL.getCheckin("plan")).rejects.toThrow();
  await expect(WeeklyNotesDAL.getTutorNote("plan")).rejects.toThrow();
});

test("an empty read is still 'none'", async () => {
  expect(await WeeklyNotesDAL.getCheckin("plan")).toBeNull();
  expect(await WeeklyNotesDAL.getTutorNote("plan")).toBeNull();
});

test("saving the verdict leaves the reflection alone, and the other way round", async () => {
  await WeeklyNotesDAL.saveCheckin({ planId: "plan", coveredOk: true, coverage: { a: "done" } });
  await WeeklyNotesDAL.saveCheckin({ planId: "plan", reflection: "Moles were hard" });
  expect(writes.map((w) => w.body)).toEqual([
    { plan_id: "plan", student_id: "student", covered_ok: true, coverage: { a: "done" } },
    { plan_id: "plan", student_id: "student", reflection: "Moles were hard" },
  ]);
});

test("a deliberate clear is still sent", async () => {
  await WeeklyNotesDAL.saveCheckin({ planId: "plan", reflection: null });
  expect(writes[0].body).toEqual({ plan_id: "plan", student_id: "student", reflection: null });
});
