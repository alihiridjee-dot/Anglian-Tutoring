import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { helpSection } from "./helpAnswers";
import * as session from "../auth/session";
import type { SearchContext } from "./types";

// The real client is built and `fetch` is stubbed below, so these only have to
// exist: without them the client throws on a machine with no local `.env`.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

const ctx: SearchContext = {
  isTutor: false,
  role: "student",
  entitledSubjects: ["biology"],
  boardBySubject: {},
  level: "gcse",
  isDemo: false,
  demoRole: null,
};
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let viewer: ReturnType<typeof spyOn<typeof session, "getSessionUserId">>;

beforeEach(() => {
  viewer = spyOn(session, "getSessionUserId").mockResolvedValue("student");
  // Cast: Bun's `typeof fetch` also carries `preconnect`, which a mock has no use for.
  network = spyOn(globalThis, "fetch").mockImplementation(
    (async () =>
      new Response(JSON.stringify([{ subject: "biology", exam_date: "2026-12-11" }]), {
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch,
  );
});
afterEach(() => {
  network.mockRestore();
  viewer.mockRestore();
  setSystemTime();
});

test("the exam answer counts weeks as the planner does: Monday to Monday", async () => {
  // Exams on Friday 11 Dec: 3 weeks and 4 days after Monday 16 Nov.
  for (const now of ["2026-11-16T09:00:00Z", "2026-11-19T15:00:00Z"]) {
    setSystemTime(new Date(now));
    const section = await helpSection("exam_date", ctx);
    expect(section.hits.map((h) => h.code)).toEqual(["3 weeks"]);
  }
});
