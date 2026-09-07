import { expect, test, spyOn } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { ScheduleDAL } from "@/lib/scheduleDal";
import { ProgramDAL } from "@/lib/programDal";
import { progressQuery, roadmapQuery, memoryQuery, courseKey, invalidatePlanner } from "./queries";
import { missingPlannerRpc } from "./readModels";

test("concurrent roadmap and memory views share one course evidence read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const p = { studentId: "student", subject: "biology", board: "aqa", level: "gcse" } as const;
  const progress = spyOn(ScheduleDAL, "getTopicProgress").mockResolvedValue([]);
  const roadmap = spyOn(ProgramDAL, "loadRoadmap").mockResolvedValue(null);
  try {
    await Promise.all([
      client.fetchQuery(roadmapQuery(client, p)),
      client.fetchQuery(roadmapQuery(client, p)),
      client.fetchQuery(memoryQuery(client, p)),
    ]);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(roadmap).toHaveBeenCalledTimes(1);
    await invalidatePlanner(client, p.studentId);
    await client.fetchQuery(progressQuery(p));
    expect(progress).toHaveBeenCalledTimes(2);
    expect(courseKey(p)).not.toEqual(courseKey({ ...p, studentId: "another" }));
    expect(courseKey(p)).not.toEqual(courseKey({ ...p, board: "ocr" }));
  } finally {
    progress.mockRestore();
    roadmap.mockRestore();
    client.clear();
  }
});
test("RPC fallback never hides permission or connection failures", () => {
  expect(missingPlannerRpc({ code: "PGRST202", message: "missing RPC" })).toBe(true);
  expect(missingPlannerRpc({ code: "42501", message: "permission denied" })).toBe(false);
  expect(missingPlannerRpc({ message: "Failed to fetch" })).toBe(false);
});
