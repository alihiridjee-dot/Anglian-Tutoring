/**
 * Check every drafted note before anyone reads it.
 *
 *   bun run scripts/notes/validate.ts            # all drafts
 *   bun run scripts/notes/validate.ts biology    # one subject
 *   bun run scripts/notes/validate.ts --set trial/a
 *   bun run scripts/notes/validate.ts biology --ids bio-020,bio-021
 *
 * Structural checks come from validateNote (it will render). On top, this
 * checks the note against its concept map: the concept exists, every spec point
 * it claims belongs to that concept, each board layer quotes that board's codes,
 * and a worked example cites a question that is in the concept's source pack.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateNote, type Note } from "../../src/lib/notes/noteFormat";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const setAt = args.indexOf("--set");
const set = setAt >= 0 ? args[setAt + 1] : "drafts";
// --ids a,b,c checks just those notes, so parallel writers don't trip over each other's half-written files.
const idsAt = args.indexOf("--ids");
const ids = idsAt >= 0 ? new Set(args[idsAt + 1].split(",")) : null;
const only = args.find((a, i) => !a.startsWith("--") && i !== setAt + 1 && i !== idsAt + 1);
let failures = 0, checked = 0;

for (const subject of ["biology", "chemistry", "physics"]) {
  if (only && only !== subject) continue;
  const dir = join(here, set, subject);
  if (!existsSync(dir)) continue;
  const map = JSON.parse(readFileSync(join(here, "concepts", `gcse-${subject}.json`), "utf8"));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && (!ids || ids.has(f.slice(0, -5)))).sort()) {
    checked++;
    const errs: string[] = [];
    let note: Note;
    try {
      note = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      console.log(`✗ ${subject}/${file}: not valid JSON (${(e as Error).message})`);
      failures++;
      continue;
    }
    errs.push(...validateNote(note));
    const concept = map.concepts.find((c: { id: string }) => c.id === note.concept_id);
    if (!concept) errs.push(`concept ${note.concept_id} is not in gcse-${subject}.json`);
    else {
      if (file !== `${note.concept_id}.json`) errs.push(`file should be named ${note.concept_id}.json`);
      const refs: { id: string; board: string; code: string }[] = concept.spec_points;
      for (const id of note.meta?.spec_point_ids ?? []) if (!refs.some((r) => r.id === id)) errs.push(`spec point ${id} is not part of ${concept.id}`);
      for (const [b, layer] of Object.entries(note.boards ?? {})) {
        const codes = refs.filter((r) => (r.board.startsWith("aqa") ? "aqa" : r.board) === b).map((r) => r.code);
        if (!codes.length) errs.push(`boards.${b}: this board has no spec point in ${concept.id}`);
        for (const c of layer?.spec_codes ?? []) if (!codes.includes(c)) errs.push(`boards.${b}: code ${c} is not one of ${codes.join(", ")}`);
      }
      const packPath = join(here, ".sources", `${concept.id}.json`);
      if (existsSync(packPath)) {
        const pack = JSON.parse(readFileSync(packPath, "utf8"));
        for (const [b, layer] of Object.entries(note.boards ?? {})) {
          const w = layer?.worked_example;
          if (!w) continue;
          const qs: { exemplar_id: string }[] = pack.boards?.[b]?.questions ?? [];
          if (!qs.some((q) => q.exemplar_id === w.exemplar_id)) errs.push(`boards.${b}: worked example ${w.exemplar_id} is not in this concept's ${b} questions`);
        }
      }
    }
    if (errs.length) {
      failures++;
      console.log(`✗ ${subject}/${file}`);
      for (const e of errs) console.log(`    ${e}`);
    } else console.log(`✓ ${subject}/${file}`);
  }
}
console.log(`\n${checked - failures}/${checked} notes pass`);
if (failures) process.exit(1);
