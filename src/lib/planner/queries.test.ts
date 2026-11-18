import { expect, test, spyOn } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { ProgramDAL } from "@/lib/planner/programDal";
import * as courseState from "@/lib/planner/courseState";
import { courseChanged, courseKey, invalidatePlanner, roadmapQuery, stateQuery } from "./queries";
import { readCourseSnapshot, readSourceRows } from "./readModels";

// `fetch` is stubbed where it is used, so these only have to exist.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

const p = { studentId: "student", subject: "biology", board: "aqa", level: "gcse" } as const;
const state = { progress: [] } as unknown as courseState.CourseState;

test("concurrent roadmap views share one course read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const read = spyOn(courseState, "readCourseState").mockResolvedValue(state);
  const roadmap = spyOn(ProgramDAL, "loadRoadmap").mockResolvedValue(null);
  try {
    await Promise.all([
      client.fetchQuery(roadmapQuery(client, p)),
      client.fetchQuery(roadmapQuery(client, p, true)),
    ]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(roadmap).toHaveBeenCalledTimes(2);
    expect(roadmap.mock.calls.every(([args]) => args.state === state)).toBe(true);
    await invalidatePlanner(client, p.studentId);
    await client.fetchQuery(stateQuery(p));
    expect(read).toHaveBeenCalledTimes(2);
    expect(courseKey(p)).not.toEqual(courseKey({ ...p, studentId: "another" }));
    expect(courseKey(p)).not.toEqual(courseKey({ ...p, board: "ocr" }));
  } finally {
    read.mockRestore();
    roadmap.mockRestore();
    client.clear();
  }
});

test("a course change re-reads its state and views, never the week that made it", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const week = [...courseKey(p), "week", "2026-10-12"];
  const other = [...courseKey({ ...p, subject: "chemistry" }), "state", "2026-10-12"];
  for (const key of [
    [...courseKey(p), "state", "x"],
    [...courseKey(p), "roadmap", "x"],
    week,
    other,
  ])
    client.setQueryData(key, 1);
  await courseChanged(client, p);
  const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
  expect(stale([...courseKey(p), "state", "x"])).toBe(true);
  expect(stale([...courseKey(p), "roadmap", "x"])).toBe(true);
  expect(stale(week)).toBe(false);
  expect(stale(other)).toBe(false);
  client.clear();
});
test("a missing planner function is an error, never an empty course", async () => {
  const missing = (name: string) => ({
    code: "PGRST202",
    message: `Could not find the function public.${name} in the schema cache`,
    details: null,
    hint: null,
  });
  // Cast: Bun's `typeof fetch` also carries `preconnect`, which a mock has no use for.
  const network = spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
  ) => {
    const name = String(input).split("/rpc/")[1]?.split("?")[0] ?? "unknown";
    return new Response(JSON.stringify(missing(name)), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch);
  try {
    await expect(readCourseSnapshot(p)).rejects.toThrow("planner_course_snapshot");
    await expect(readSourceRows(["point"])).rejects.toThrow("planner_attempt_sources");
  } finally {
    network.mockRestore();
  }
});
