import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { supabase } from "@/integrations/supabase/client";
import {
  checkCourse,
  handlePlanHealRequest,
  tally,
  withClient,
  type CheckRun,
} from "./planHeal.server";
import { ProgramDAL } from "./programDal";
import { WeeklyPlanDAL } from "./weeklyPlanDal";
import { SubjectPauseDAL } from "./pausesDal";
import { BreakDAL } from "./breaksDal";
import type { PacingBand } from "./pacing";
import type { RoadmapResult } from "./roadmap";

const originalFetch = globalThis.fetch;
const envNames = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PRACTICE_WORKER_SECRET"] as const;
const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const restore: { mockRestore(): void }[] = [];
const spy = <T extends object, K extends keyof T>(object: T, method: K) => {
  const s = spyOn(object, method);
  restore.push(s);
  return s;
};
beforeEach(() => {
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
  delete process.env.PRACTICE_WORKER_SECRET;
  spy(console, "info").mockImplementation(() => {});
  spy(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  restore.splice(0).forEach((s) => s.mockRestore());
});

const SECRET = "s".repeat(40);
const post = (body: unknown, authorization = `Bearer ${SECRET}`) =>
  new Request("https://site.example/api/plan-heal", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("handlePlanHealRequest", () => {
  test("answers only a POST", async () => {
    const res = await handlePlanHealRequest(new Request("https://site.example/api/plan-heal"));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  test("fails closed without a proper secret, and refuses the wrong one", async () => {
    expect((await handlePlanHealRequest(post({}))).status).toBe(503);
    process.env.PRACTICE_WORKER_SECRET = "short";
    expect((await handlePlanHealRequest(post({}))).status).toBe(503);
    process.env.PRACTICE_WORKER_SECRET = SECRET;
    expect((await handlePlanHealRequest(post({}, "Bearer nope"))).status).toBe(401);
    expect((await handlePlanHealRequest(post({}, ""))).status).toBe(401);
  });

  test("checks this week's saved plans with the service key and records the run", async () => {
    process.env.PRACTICE_WORKER_SECRET = SECRET;
    const calls: { url: URL; method: string; headers: Headers; body: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ""),
      });
      if (url.pathname.endsWith("/student_weekly_plans")) return Response.json([]);
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const res = await handlePlanHealRequest(post({ dryRun: true }));
    expect(res.status).toBe(200);
    const run = (await res.json()) as CheckRun;
    expect(run).toMatchObject({ dryRun: true, courses: [], unreached: 0 });
    expect(run.week).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [list, record] = calls;
    expect(list.url.origin).toBe("https://database.example");
    expect(list.url.searchParams.get("week_start")).toBe(`eq.${run.week}`);
    expect(record.url.pathname).toBe("/rest/v1/rpc/record_plan_heal_run");
    expect(JSON.parse(record.body)).toEqual({
      _week_start: run.week,
      _dry_run: true,
      _report: run,
    });
    for (const call of calls) {
      // The secret key is opaque: an apikey header, never a bearer token.
      expect(call.headers.get("apikey")).toBe("sb_secret_test");
      expect(call.headers.get("authorization")).toBeNull();
    }
  });

  test("anything but a literal true is a real run", async () => {
    process.env.PRACTICE_WORKER_SECRET = SECRET;
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      String(input).includes("/student_weekly_plans")
        ? Response.json([])
        : new Response(null, { status: 204 })) as typeof fetch;
    for (const body of [{}, { dryRun: "true" }, { dryRun: 1 }, null]) {
      const run = (await (await handlePlanHealRequest(post(body))).json()) as CheckRun;
      expect(run.dryRun).toBe(false);
    }
  });
});

describe("withClient", () => {
  const fake = (name: string) =>
    ({ from: () => name }) as unknown as Parameters<typeof withClient>[0];

  test("hands every supabase call inside a run, and only inside it, the run's client", async () => {
    const a = fake("a");
    const b = fake("b");
    const seen: string[] = [];
    await Promise.all([
      withClient(a, async () => {
        await Bun.sleep(5);
        seen.push(`a:${supabase.from("x" as never) as unknown as string}`);
      }),
      withClient(b, async () => {
        seen.push(`b:${supabase.from("x" as never) as unknown as string}`);
        await Bun.sleep(10);
        seen.push(`b:${supabase.from("x" as never) as unknown as string}`);
      }),
    ]);
    expect(seen.sort()).toEqual(["a:a", "b:b", "b:b"]);
    // Outside a run the shared client answers, never a run's.
    expect(supabase.from).not.toBe(a.from);
    expect(supabase.from).not.toBe(b.from);
  });
});

describe("checkCourse", () => {
  const WEEK = "2026-10-05";
  const row = {
    student_id: "s1",
    subject: "biology" as const,
    board: "cambridge" as const,
    level: "igcse" as const,
    week_start: WEEK,
  };
  const course = async () => ({ board: "cambridge" as const, level: "igcse" as const });
  const band: PacingBand = {
    topicId: "t1",
    title: "Topic",
    kind: "teach",
    startWeek: WEEK,
    endWeek: "2026-10-19",
    weeks: 3,
  };
  const roadmap = (over: Partial<RoadmapResult> = {}) =>
    ({ storedBands: [band], needsAck: false, ...over }) as RoadmapResult;
  const saved = { plan: { id: "p1" }, points: [], withheld: [] } as unknown as Awaited<
    ReturnType<typeof WeeklyPlanDAL.getPlan>
  >;
  let mocks: ReturnType<typeof setUp>;
  const setUp = () => ({
    open: spy(SubjectPauseDAL, "open").mockResolvedValue(null),
    history: spy(SubjectPauseDAL, "history").mockResolvedValue([]),
    breaks: spy(BreakDAL, "list").mockResolvedValue([]),
    load: spy(ProgramDAL, "loadRoadmap").mockResolvedValue(roadmap()),
    apply: spy(ProgramDAL, "applyPending").mockResolvedValue(roadmap()),
    getPlan: spy(WeeklyPlanDAL, "getPlan").mockResolvedValue(saved),
    behind: spy(ProgramDAL, "weekBehindPlan").mockResolvedValue(null),
    refresh: spy(ProgramDAL, "refreshWeek").mockResolvedValue(true),
  });
  beforeEach(() => {
    mocks = setUp();
  });

  test("a week in step is left as it is", async () => {
    expect(await checkCourse(row, false, course)).toEqual({
      studentId: "s1",
      subject: "biology",
      outcome: "in-step",
    });
    expect(mocks.behind).toHaveBeenCalledWith({
      studentId: "s1",
      weekStart: WEEK,
      saved,
      roadmap: roadmap(),
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  test("a week behind its plan is re-cut, or only reported on a dry run", async () => {
    mocks.behind.mockResolvedValue({ missing: [], stale: ["a3", "a4"] });
    expect(await checkCourse(row, true, course)).toMatchObject({
      outcome: "would-heal",
      missing: 0,
      stale: 2,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();

    expect(await checkCourse(row, false, course)).toMatchObject({
      outcome: "healed",
      missing: 0,
      stale: 2,
    });
    expect(mocks.refresh).toHaveBeenCalledWith({
      studentId: "s1",
      subject: "biology",
      board: "cambridge",
      level: "igcse",
      weekStart: WEEK,
    });
    mocks.refresh.mockResolvedValue(false);
    expect((await checkCourse(row, false, course)).outcome).toBe("unchanged");
  });

  test("a re-flow waiting in the full plan is applied as the planner does, or reported", async () => {
    mocks.load.mockResolvedValue(roadmap({ needsAck: true }));
    expect((await checkCourse(row, true, course)).outcome).toBe("would-apply");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect((await checkCourse(row, false, course)).outcome).toBe("plan-applied");
    expect(mocks.apply).toHaveBeenCalledWith({
      studentId: "s1",
      subject: "biology",
      board: "cambridge",
      level: "igcse",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  test("a custom topic order's re-flow waits for someone signed in", async () => {
    const custom = { ...band, schedule: { version: 1, from: WEEK, examDate: "2027-06-07" } };
    mocks.load.mockResolvedValue(roadmap({ needsAck: true, storedBands: [custom] }));
    expect(await checkCourse(row, false, course)).toMatchObject({
      outcome: "left",
      reason: "custom order to re-flow",
    });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  test("it stops where a student's own visit stops, before reading the plan", async () => {
    mocks.open.mockResolvedValue({ reason: "paused", startedAt: "2026-10-01T00:00:00Z" } as never);
    expect(await checkCourse(row, false, course)).toMatchObject({
      outcome: "left",
      reason: "subject stopped",
    });
    mocks.open.mockResolvedValue(null);

    mocks.breaks.mockResolvedValue([
      {
        id: "b",
        startsOn: "2026-10-05",
        endsOn: "2026-10-18",
        reason: "holiday",
        recordedAt: null,
      },
    ] as never);
    expect(await checkCourse(row, false, course)).toMatchObject({
      outcome: "left",
      reason: "break week",
    });
    mocks.breaks.mockResolvedValue([]);

    // Picking a plan up after a pause saves it: a visit does that, and a dry run must not.
    mocks.history.mockResolvedValue([
      {
        id: "p",
        reason: "paused",
        startedAt: "2026-09-01T00:00:00Z",
        endedAt: "2026-09-20T00:00:00Z",
        programmeResumedAt: null,
      },
    ] as never);
    expect(await checkCourse(row, true, course)).toMatchObject({
      outcome: "left",
      reason: "pause to pick up",
    });
    mocks.history.mockResolvedValue([]);

    expect(await checkCourse(row, false, async () => null)).toMatchObject({
      outcome: "left",
      reason: "no course",
    });
    expect(
      await checkCourse(row, false, async () => ({
        board: "edexcel" as const,
        level: "igcse" as const,
      })),
    ).toMatchObject({ outcome: "left", reason: "course changed" });
    expect(mocks.load).not.toHaveBeenCalled();

    mocks.load.mockResolvedValue(roadmap({ storedBands: undefined }));
    expect(await checkCourse(row, false, course)).toMatchObject({
      outcome: "left",
      reason: "no full plan",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  test("a failure is reported, not thrown", async () => {
    mocks.refresh.mockRejectedValue(new Error("This is a break week"));
    mocks.behind.mockResolvedValue({ missing: ["a1"], stale: [] });
    expect(await checkCourse(row, false, course)).toEqual({
      studentId: "s1",
      subject: "biology",
      outcome: "failed",
      error: "This is a break week",
    });
  });
});

test("tally counts outcomes, with no student in it", () => {
  const run: CheckRun = {
    week: "2026-10-05",
    dryRun: false,
    unreached: 1,
    courses: [
      { studentId: "s1", subject: "biology", outcome: "healed" },
      { studentId: "s2", subject: "biology", outcome: "healed" },
      { studentId: "s3", subject: "physics", outcome: "in-step" },
    ],
  };
  expect(tally(run)).toEqual({ unreached: 1, healed: 2, "in-step": 1 });
});
