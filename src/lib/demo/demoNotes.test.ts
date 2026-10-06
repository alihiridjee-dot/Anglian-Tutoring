import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateNote, type Note } from "@/lib/notes/noteFormat";
import { DEMO_SPEC_POINT_NOTES, demoSpecPointNotes } from "./demoNotes";
import { DEMO_CURRICULUM_SPEC_POINTS, DEMO_ENROLMENTS } from "./studentDemo";

const DIR = join(import.meta.dir, "notes");
const fixtures = new Map(
  readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [
      f.slice(0, -".json".length),
      JSON.parse(readFileSync(join(DIR, f), "utf8")) as Note,
    ]),
);
const onTheMap = Object.entries(DEMO_SPEC_POINT_NOTES).flatMap(([point, notes]) =>
  notes.map((n) => ({ point, ...n })),
);
const demoPoints = Object.values(DEMO_CURRICULUM_SPEC_POINTS).flatMap((ps) => ps.map((p) => p.id));

describe("the showcase's revision notes", () => {
  test("every fixture is a note that renders", () => {
    expect(fixtures.size).toBeGreaterThan(0);
    for (const [id, note] of fixtures) {
      expect({ id, errors: validateNote(note) }).toEqual({ id, errors: [] });
      expect(note.concept_id).toBe(id);
    }
  });

  test("every note on the map has a fixture, and every fixture is on the map", () => {
    expect([...new Set(onTheMap.map((n) => n.id))].sort()).toEqual([...fixtures.keys()].sort());
    for (const n of onTheMap) {
      expect(n.title).toBe(fixtures.get(n.id)!.title);
      expect(fixtures.get(n.id)!.meta.spec_point_ids).toContain(n.point);
    }
  });

  test("every demo spec point has exactly one primary note, listed first", () => {
    expect(Object.keys(DEMO_SPEC_POINT_NOTES).sort()).toEqual([...demoPoints].sort());
    const byPoint = demoSpecPointNotes(demoPoints);
    for (const point of demoPoints) {
      const notes = byPoint.get(point) ?? [];
      expect({ point, primaries: notes.filter((n) => n.primary).length }).toEqual({
        point,
        primaries: 1,
      });
      expect(notes[0].primary).toBe(true);
    }
  });

  test("each fixture keeps one board layer: the board the demo student sits", () => {
    for (const [id, note] of fixtures) {
      const sits = DEMO_ENROLMENTS.find((e) => e.subject === note.subject)?.board;
      expect({ id, boards: Object.keys(note.boards) }).toEqual({ id, boards: [sits!] });
    }
  });
});
