import { describe, expect, it } from "bun:test";
import { pageAbove } from "./returnSpot";

const at = (pathname: string, search: Record<string, unknown> = {}) => ({ pathname, search });
const ID = "2c9f0e7a-1111-4222-8333-944455556666";

describe("pageAbove", () => {
  it("sends one of a list back to its list", () => {
    expect(pageAbove(at(`/homework/${ID}`), "/student-dashboard")).toBe("/homework");
    expect(pageAbove(at(`/mcq/${ID}`), "/student-dashboard")).toBe("/mcqs");
    expect(pageAbove(at("/notes/photosynthesis"), "/student-dashboard")).toBe("/curriculum");
    expect(pageAbove(at(`/students/${ID}`), "/tutor")).toBe("/students");
  });

  it("keeps the showcase inside the showcase", () => {
    expect(pageAbove(at("/demo/student/homework/demo-hw-1"), "/demo/student/dashboard")).toBe(
      "/demo/student/homework",
    );
    expect(pageAbove(at("/demo/student/mcq/demo-set-1"), "/demo/student/dashboard")).toBe(
      "/demo/student/mcqs",
    );
    expect(pageAbove(at("/demo/student/planner"), "/demo/student/dashboard")).toBe(
      "/demo/student/dashboard",
    );
  });

  it("sends a spec point to its curriculum", () => {
    expect(pageAbove(at("/curriculum", { point: ID }), "/student-dashboard")).toBe("/curriculum");
  });

  it("sends any other page home, and home nowhere", () => {
    expect(pageAbove(at("/curriculum"), "/student-dashboard")).toBe("/student-dashboard");
    expect(pageAbove(at("/billing"), "/parent-dashboard")).toBe("/parent-dashboard");
    expect(pageAbove(at("/student-dashboard"), "/student-dashboard")).toBeNull();
    expect(pageAbove(at("/tutor"), "/tutor")).toBeNull();
  });
});
