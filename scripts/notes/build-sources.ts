/**
 * Build the source pack a revision note is written from.
 *
 *   bun run scripts/notes/build-sources.ts biology "Cell biology"
 *   bun run scripts/notes/build-sources.ts biology bio-012
 *
 * For each concept in the group (or the one concept named), it writes
 * scripts/notes/.sources/<concept id>.json holding:
 *   - every spec point the note covers, with its full board wording
 *   - the approved past-paper questions tagged to those points, with their
 *     mark schemes, grouped by board
 *
 * Read-only against the database. The packs are gitignored: they carry exam
 * board questions, which stay in the database and out of the repository.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (exemplars sit behind
 * tutor-only RLS and this runs outside a session).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { layerOf, loadConceptMap, type Concept } from "./conceptMap";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

const argv = process.argv.slice(2);
// --only cambridge_igcse,edexcel_igcse keeps just those courses (a layer-only writer needs no more).
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? new Set(argv[onlyAt + 1].split(",")) : null;
const [subject, which] = onlyAt >= 0 ? argv.filter((_, i) => i !== onlyAt && i !== onlyAt + 1) : argv;
if (!subject || !which)
  throw new Error('Usage: build-sources.ts <subject> <"Group name" | concept id> [--only course,course]');

const here = dirname(fileURLToPath(import.meta.url));
const map = loadConceptMap(subject);
const concepts: Concept[] = map.concepts.filter(
  (c: Concept) => c.id === which || c.group === which,
);
if (!concepts.length) throw new Error(`No concept or group called ${which}`);

const headers = {
  apikey: key,
  ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
};
async function get(path: string) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}
const inList = (ids: string[]) => `in.(${ids.join(",")})`;
const board = layerOf;

const outDir = join(here, ".sources");
mkdirSync(outDir, { recursive: true });

for (const c of concepts) {
  const ids = c.spec_points.map((r) => r.id);
  const points = await get(`spec_points?select=id,code,title,description&id=${inList(ids)}`);
  const links = await get(
    `exam_exemplar_spec_points?select=exemplar_id,spec_point_id&spec_point_id=${inList(ids)}`,
  );
  const exIds = [...new Set(links.map((l: { exemplar_id: string }) => l.exemplar_id))] as string[];
  const exemplars = exIds.length
    ? await get(
        `exam_exemplars?select=id,board,year,series,paper,tier,question_label,marks,command_word,shared_context,prompt,mark_scheme,needs_image,flags,approved_at&id=${inList(exIds)}`,
      )
    : [];
  const usable = exemplars.filter(
    (e: { approved_at: string | null; mark_scheme: string | null; flags: string[] | null }) =>
      e.approved_at && e.mark_scheme && !(e.flags ?? []).length,
  );

  const byBoard: Record<string, unknown> = {};
  for (const r of c.spec_points) {
    const b = board(r.board);
    const p = points.find((x: { id: string }) => x.id === r.id);
    const slot = (byBoard[b] ??= { spec_points: [], questions: [] }) as {
      spec_points: unknown[];
      questions: unknown[];
    };
    slot.spec_points.push({
      id: r.id,
      code: r.code,
      course: r.board,
      primary: r.primary,
      title: p?.title,
      description: p?.description,
    });
  }
  // A question belongs to the course of the spec point it is tagged to, not to
  // its own board: Edexcel GCSE and Edexcel IGCSE questions must not mix.
  const courseOf = new Map(c.spec_points.map((r) => [r.id, board(r.board)]));
  for (const e of usable) {
    const courses = new Set<string>(
      links
        .filter((l: { exemplar_id: string }) => l.exemplar_id === e.id)
        .map((l: { spec_point_id: string }) => courseOf.get(l.spec_point_id))
        .filter(Boolean),
    );
    for (const b of courses) {
      const slot = (byBoard[b] ??= { spec_points: [], questions: [] }) as { questions: unknown[] };
      slot.questions.push({
        exemplar_id: e.id,
        source: `${e.board.toUpperCase()} ${e.series} ${e.year}, Paper ${e.paper}${e.tier ? ` (${e.tier})` : ""}, Q${e.question_label}`,
        marks: e.marks,
        command_word: e.command_word,
        needs_image: e.needs_image,
        context: e.shared_context,
        question: e.prompt,
        mark_scheme: e.mark_scheme,
      });
    }
  }
  if (only) for (const b of Object.keys(byBoard)) if (!only.has(b)) delete byBoard[b];
  // Most marks first: the richest mark schemes are the most useful to write from.
  for (const s of Object.values(byBoard) as { questions: { marks: number }[] }[])
    s.questions.sort((a, b) => b.marks - a.marks);

  const pack = { concept: { ...c, spec_points: undefined }, boards: byBoard };
  // A filtered pack goes to its own file so it never replaces the full pack validate.ts reads.
  writeFileSync(join(outDir, `${c.id}${only ? ".igcse" : ""}.json`), JSON.stringify(pack, null, 2));
  const counts = Object.entries(byBoard)
    .map(([b, s]) => `${b} ${(s as { questions: unknown[] }).questions.length}q`)
    .join(", ");
  console.log(`${c.id} ${c.title}: ${counts}`);
}
