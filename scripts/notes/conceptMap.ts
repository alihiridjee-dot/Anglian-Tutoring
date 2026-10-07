/**
 * The concept map of a subject: the GCSE concepts (concepts/gcse-<subject>.json)
 * merged with the IGCSE file (concepts/igcse-<subject>.json), which holds
 *   - `joins`: IGCSE spec points that join an existing GCSE concept, and
 *   - `concepts`: IGCSE-only concepts, which have their own notes.
 * The GCSE files are never edited for IGCSE. Each ref's `board` is the course
 * key, which is also the key of that course's board layer in a note.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Ref = { id: string; board: string; code: string; primary: boolean };
export type Concept = {
  id: string;
  group: string;
  title: string;
  scope: string;
  kind: string;
  higher_only: boolean;
  separate_only: boolean;
  data_note?: string;
  spec_points: Ref[];
  /** "gcse" for the original concepts, "igcse" for IGCSE-only ones. */
  level: "gcse" | "igcse";
};

const here = dirname(fileURLToPath(import.meta.url));

/** aqa_trilogy sits in the AQA layer; every other course is its own layer. */
export const layerOf = (board: string) => (board.startsWith("aqa") ? "aqa" : board);

export function loadConceptMap(subject: string): { concepts: Concept[] } {
  const gcse = JSON.parse(readFileSync(join(here, "concepts", `gcse-${subject}.json`), "utf8"));
  const concepts: Concept[] = gcse.concepts.map((c: Concept) => ({ ...c, level: "gcse" }));
  const file = join(here, "concepts", `igcse-${subject}.json`);
  if (!existsSync(file)) return { concepts };
  const igcse = JSON.parse(readFileSync(file, "utf8")) as {
    joins: { concept_id: string; spec_points: Ref[] }[];
    concepts: Omit<Concept, "level">[];
  };
  for (const j of igcse.joins) {
    const c = concepts.find((x) => x.id === j.concept_id);
    if (!c) throw new Error(`igcse-${subject}.json joins ${j.concept_id}, which is not a concept`);
    c.spec_points = [...c.spec_points, ...j.spec_points];
  }
  for (const c of igcse.concepts) {
    if (concepts.some((x) => x.id === c.id)) throw new Error(`duplicate concept id ${c.id}`);
    concepts.push({ ...c, level: "igcse" });
  }
  return { concepts };
}
