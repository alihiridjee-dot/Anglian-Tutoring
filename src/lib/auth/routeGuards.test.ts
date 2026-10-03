import { describe, expect, test } from "bun:test";
import { roleHomePath } from "./routeGuards";
import type { GuardState } from "./guardState";
import { UserRole } from "@/types/user";

const viewer = (appRole: UserRole, role: string | null = appRole): GuardState => ({
  userId: "u1",
  role,
  appRole,
  onboardingComplete: true,
  hasAccess: true,
});

describe("roleHomePath — where /dashboard sends each role", () => {
  test("tutors and admins go to the Studio, never the Parent Portal", () => {
    expect(roleHomePath({ context: { viewer: viewer(UserRole.TUTOR) } })).toBe("/tutor");
    expect(roleHomePath({ context: { viewer: viewer(UserRole.ADMIN) } })).toBe("/tutor");
  });

  test("parents go to the Portal", () => {
    expect(roleHomePath({ context: { viewer: viewer(UserRole.PARENT) } })).toBe(
      "/parent-dashboard",
    );
  });

  test("students, and a caller with no viewer, go to the student dashboard", () => {
    expect(roleHomePath({ context: { viewer: viewer(UserRole.STUDENT) } })).toBe(
      "/student-dashboard",
    );
    expect(roleHomePath({ context: {} })).toBe("/student-dashboard");
  });
});
