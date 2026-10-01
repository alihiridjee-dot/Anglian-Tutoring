import { describe, expect, it } from "bun:test";
import { buildAuthedNav } from "./nav";
import { firstName, welcomeHome, welcomeSteps, type WelcomeStep } from "./welcomeTour";

const words = (steps: WelcomeStep[]) =>
  steps
    .flatMap((s) => [s.title, ...s.body, ...(s.week ?? []).flatMap((r) => [r.label, r.detail])])
    .join("\n");

const student = (name: string | null = "Sam") => welcomeSteps("student", { name, children: [] });
const parent = (children: string[], name: string | null = "Jo") =>
  welcomeSteps("parent", { name, children });

describe("welcomeSteps", () => {
  it("starts and ends on the account's own home page", () => {
    expect(student()[0].path).toBe("/student-dashboard");
    expect(student().at(-1)!.path).toBe("/student-dashboard");
    for (const steps of [parent(["Sam"]), parent([])]) {
      expect(steps[0].path).toBe("/parent-dashboard");
      expect(steps.at(-1)!.path).toBe("/parent-dashboard");
    }
  });

  it("only visits pages in the student's own sidebar", () => {
    const sidebar = buildAuthedNav({ isTutor: false, role: "student" }).map((i) => i.to as string);
    for (const step of student()) expect(sidebar).toContain(step.path);
  });

  it("only visits pages in a parent's own sidebar", () => {
    const sidebar = buildAuthedNav({ isTutor: false, role: "parent" }).map((i) => i.to as string);
    for (const step of [...parent(["Sam"]), ...parent([])]) expect(sidebar).toContain(step.path);
  });

  it("explains the idea and what the plan includes before showing any page", () => {
    for (const steps of [student(), parent(["Sam"])]) {
      expect(steps[0].targets).toEqual([]);
      expect(steps[1].targets).toEqual([]);
      expect(steps[1].visual).toBe("week");
      expect(steps[1].week?.length).toBe(5);
    }
  });

  it("greets by first name, and still reads without one", () => {
    expect(student("Sam")[0].title).toBe("Welcome to Anglia Educate, Sam!");
    expect(student(null)[0].title).toBe("Welcome to Anglia Educate!");
    expect(student(null).at(-1)!.title).toBe("You’re all set!");
  });

  it("names a parent's only child, and says 'your child' otherwise", () => {
    expect(words(parent(["Sam"]))).toContain("Sam gets live lessons");
    expect(words(parent(["Sam", "Alex"]))).toContain("Your child gets live lessons");
    expect(words(parent(["Sam", "Alex"]))).not.toContain("Sam");
  });

  it("sends a parent with no child linked to link one, and skips the progress steps", () => {
    const steps = parent([]);
    expect(steps.map((s) => s.path)).toEqual([
      "/parent-dashboard",
      "/parent-dashboard",
      "/parents",
      "/billing",
      "/parent-dashboard",
    ]);
    expect(steps[2].title).toBe("Link your child");
    expect(words(steps)).not.toContain("predicted");
  });

  // The marketing pages promise some of these. The app doesn't do them, so a
  // student taking the tour must not be told it does.
  it("promises nothing the app doesn't do", () => {
    const all = words([...student(), ...parent(["Sam"]), ...parent([])]);
    for (const claim of [
      /record/i, // live lessons are not recorded
      /teams/i, // lessons are on Zoom
      /a week for each subject|per subject/i, // the timetable is the tutors' to set
      /tutor marks|marked by (your|their|a) tutor/i, // marking isn't the tutor's alone
      /worksheet|download/i, // there are no downloads
      /attend/i, // attendance isn't recorded
      /rated|confidence/i, // the plan doesn't use setup ratings
    ]) {
      expect(all).not.toMatch(claim);
    }
  });

  it("gives every page step something to point at", () => {
    for (const step of [...student(), ...parent(["Sam"])]) {
      if (step.path !== welcomeHome("student") && step.path !== welcomeHome("parent")) {
        expect(step.targets.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("firstName", () => {
  it("takes the first word of a name", () => {
    expect(firstName("Sam Taylor")).toBe("Sam");
    expect(firstName("  Sam  ")).toBe("Sam");
  });

  it("is null for a blank or missing name", () => {
    expect(firstName("")).toBeNull();
    expect(firstName("   ")).toBeNull();
    expect(firstName(null)).toBeNull();
    expect(firstName(undefined)).toBeNull();
  });
});
