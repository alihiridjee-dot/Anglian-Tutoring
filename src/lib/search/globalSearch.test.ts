import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { noteLevelsFor, noteOnCourse, quizVisible, runGlobalSearch } from "./globalSearch";
import type { SearchContext } from "./types";

// The real client is built and `fetch` is stubbed below, so these only have to
// exist: without them the client throws on a machine with no local `.env`.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

describe("noteLevelsFor", () => {
  test("each course searches the notes it reads", () => {
    expect(noteLevelsFor("gcse")).toEqual(["gcse"]);
    expect(noteLevelsFor("gcse_trilogy")).toEqual(["gcse"]);
    expect(noteLevelsFor("igcse")).toEqual(["gcse", "igcse"]);
    expect(noteLevelsFor("alevel")).toEqual(["alevel"]);
  });
});

/** Edexcel IGCSE Chemistry and Cambridge IGCSE Biology: two boards, one level. */
const student: SearchContext = {
  isTutor: false,
  role: "student",
  entitledSubjects: ["chemistry", "biology"],
  boardBySubject: { chemistry: "edexcel", biology: "cambridge" },
  level: "igcse",
  isDemo: false,
  demoRole: null,
};
const tutor: SearchContext = { ...student, isTutor: true, role: "tutor" };

describe("a student is offered only notes written for their course", () => {
  test("a note needs the layer for the board they sit that subject with", () => {
    expect(noteOnCourse(student, "chemistry", { edexcel_igcse: ["IGCSE 1.29"] })).toBe(true);
    expect(noteOnCourse(student, "chemistry", { edexcel_igcse: null })).toBe(false);
    expect(noteOnCourse(student, "chemistry", {})).toBe(false);
    // Another subject reads its own board's layer.
    expect(noteOnCourse(student, "biology", { cambridge_igcse: ["CAIE 2.1"] })).toBe(true);
    expect(noteOnCourse(student, "biology", { edexcel_igcse: ["IGCSE 2.1"] })).toBe(false);
  });

  test("a tutor, and a subject with no known board, are not filtered", () => {
    expect(noteOnCourse(tutor, "chemistry", {})).toBe(true);
    expect(noteOnCourse(student, "physics", {})).toBe(true);
  });
});

describe("a student is offered only quizzes on their course", () => {
  const quiz = (subject: string, board: string, level: string) => ({
    subject,
    spec_points: { topics: { subject, board, level } },
  });

  test("a quiz is on the course of the spec point it tests", () => {
    expect(quizVisible(student, quiz("chemistry", "edexcel", "igcse"))).toBe(true);
    expect(quizVisible(student, quiz("chemistry", "cambridge", "igcse"))).toBe(false);
    expect(quizVisible(student, quiz("chemistry", "edexcel", "alevel"))).toBe(false);
    expect(quizVisible(student, quiz("chemistry", "aqa", "gcse"))).toBe(false);
    expect(quizVisible(student, quiz("biology", "cambridge", "igcse"))).toBe(true);
    expect(quizVisible(student, quiz("physics", "edexcel", "igcse"))).toBe(false);
  });

  test("a quiz with no subject of its own takes its spec point's", () => {
    const row = { ...quiz("chemistry", "ocr", "alevel"), subject: null };
    expect(quizVisible(student, row)).toBe(false);
  });

  test("a tutor sees every quiz", () => {
    expect(quizVisible(tutor, quiz("chemistry", "ocr", "alevel"))).toBe(true);
  });
});

describe("the search asks for, and keeps, only the student's own course", () => {
  const asked: URL[] = [];
  let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  /** What the database hands back, before the app's own filter: every board. */
  const rows: Record<string, unknown[]> = {
    mcq_sets: [
      {
        id: "own",
        title: "IGCSE 1.29 Reacting masses and the limiting reactant",
        description: null,
        published: true,
        subject: "chemistry",
        spec_point_id: "p1",
        spec_points: { topics: { subject: "chemistry", board: "edexcel", level: "igcse" } },
      },
      {
        id: "alevel",
        title: "EDEX 5.4 Limiting reagents",
        description: null,
        published: true,
        subject: "chemistry",
        spec_point_id: "p2",
        spec_points: { topics: { subject: "chemistry", board: "edexcel", level: "alevel" } },
      },
    ],
    notes: [
      {
        concept_id: "chem-034",
        edexcel_igcse: null,
        cambridge_igcse: ["CAIE 3.3.5S"],
        note_concepts: {
          title: "Limiting reactants",
          chapter: "Quantitative chemistry",
          subject: "chemistry",
          level: "gcse",
        },
      },
      {
        concept_id: "chem-900",
        edexcel_igcse: ["IGCSE 1.29"],
        cambridge_igcse: null,
        note_concepts: {
          title: "Limiting reactants in reacting masses",
          chapter: "Quantitative chemistry",
          subject: "chemistry",
          level: "gcse",
        },
      },
    ],
  };

  beforeEach(() => {
    asked.length = 0;
    network = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      asked.push(url);
      const table = url.pathname.split("/").pop() ?? "";
      return new Response(JSON.stringify(rows[table] ?? []), {
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch);
  });
  afterEach(() => network.mockRestore());

  const request = (table: string) => asked.find((u) => u.pathname.endsWith(`/${table}`));

  test("quizzes are fetched for the student's subjects and level", async () => {
    await runGlobalSearch("limiting", student);
    const q = request("mcq_sets")!;
    expect(q.searchParams.get("select")).toContain("spec_points!inner(topics!inner(");
    expect(q.searchParams.get("spec_points.topics.level")).toBe("eq.igcse");
    expect(q.searchParams.get("spec_points.topics.subject")).toBe("in.(chemistry,biology)");
    expect(q.searchParams.get("published")).toBe("eq.true");
  });

  test("notes carry just the spec codes of each layer the student reads", async () => {
    await runGlobalSearch("limiting", student);
    const select = request("notes")!.searchParams.get("select") ?? "";
    expect(select).toContain("edexcel_igcse:body->boards->edexcel_igcse->spec_codes");
    expect(select).toContain("cambridge_igcse:body->boards->cambridge_igcse->spec_codes");
  });

  test("another course's quiz and a note without the student's layer are dropped", async () => {
    const sections = await runGlobalSearch("limiting", student);
    const ids = (group: string) =>
      sections.find((s) => s.group === group)?.hits.map((h) => h.key) ?? [];
    expect(ids("mcq_set")).toEqual(["mcq_set:own"]);
    expect(ids("note")).toEqual(["note:chem-900"]);
  });

  test("a tutor's search is not narrowed", async () => {
    const sections = await runGlobalSearch("limiting", tutor);
    const q = request("mcq_sets")!;
    expect(q.searchParams.get("select")).not.toContain("!inner");
    expect(q.searchParams.has("spec_points.topics.level")).toBe(false);
    expect(request("notes")!.searchParams.get("select")).not.toContain("spec_codes");
    expect(sections.find((s) => s.group === "mcq_set")?.hits).toHaveLength(2);
    expect(sections.find((s) => s.group === "note")?.hits).toHaveLength(2);
  });
});
