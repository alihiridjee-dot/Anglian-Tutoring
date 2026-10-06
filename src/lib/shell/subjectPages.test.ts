import { describe, expect, it } from "bun:test";
import { followsSubject } from "./subjectPages";

describe("followsSubject", () => {
  it("shows the slider on the pages that follow it, records included", () => {
    for (const path of [
      "/student-dashboard",
      "/planner",
      "/planner-order",
      "/curriculum",
      "/homework",
      "/homework/2c9f0e7a-1111-4222-8333-944455556666",
      "/mcqs",
      "/mcq/2c9f0e7a-1111-4222-8333-944455556666",
      "/live",
      "/notes/photosynthesis",
    ]) {
      expect(followsSubject(path)).toBe(true);
    }
  });

  it("hides it where nothing changes with the subject", () => {
    for (const path of ["/parents", "/profile", "/settings", "/billing", "/messages", "/videos"]) {
      expect(followsSubject(path)).toBe(false);
    }
  });

  it("reads the showcase's pages as the pages they stand for", () => {
    expect(followsSubject("/demo/student/dashboard")).toBe(true);
    expect(followsSubject("/demo/student/homework/demo-hw-photosynthesis")).toBe(true);
    expect(followsSubject("/demo/student/notes/bio-012")).toBe(true);
    expect(followsSubject("/demo/student/messages")).toBe(false);
    expect(followsSubject("/demo/parent/dashboard")).toBe(false);
  });

  it("matches whole path segments only", () => {
    expect(followsSubject("/homeworkish")).toBe(false);
    expect(followsSubject("/mcqs-archive")).toBe(false);
    expect(followsSubject("/")).toBe(false);
  });
});
