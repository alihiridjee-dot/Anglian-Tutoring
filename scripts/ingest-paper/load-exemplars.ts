/**
 * Load parsed exam questions into the exemplar library.
 *
 * Takes rows in the shape split_paper.py `--json` produces and writes them to
 * `exam_exemplars`. Approval is the database's job, not this script's: a row
 * that arrives complete — text, marks, its own mark scheme, no flags, no
 * missing figure — is approved on the way in, and one that does not is held
 * back until a later ingest mends it.
 *
 *   python3 scripts/ingest-paper/split_paper.py QP.pdf MS.pdf --json > rows.json
 *   bun run scripts/ingest-paper/load-exemplars.ts rows.json          # preview
 *   bun run scripts/ingest-paper/load-exemplars.ts rows.json --write  # insert
 *
 * Preview by default — it prints what it would write and touches nothing.
 * Re-running the same paper updates its rows rather than duplicating them.
 *
 * Provenance comes from the filename the renamer produced
 * (edexcel-physics-gcse-2018-p1F-QP.pdf), so run these against renamed papers
 * or pass --board/--subject/--level explicitly.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: the table is behind
 * tutor-only RLS and this runs outside a session.
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

const args = process.argv.slice(2);
const valueFlags = new Set(["--board", "--subject", "--level", "--year"]);
const files = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));
const write = args.includes("--write");
if (files.length === 0) throw new Error("Give at least one --json file from split_paper.py");

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

type Row = {
  label: string;
  q: string;
  prompt: string;
  marks: number | null;
  options: { letter: string; text: string }[] | null;
  flags: string[];
  mark_scheme?: string | null;
  shared_context?: string | null;
  specification_version?: string | null;
  source_reference?: Record<string, unknown>;
  command_word?: string | null;
  assessment_objectives?: string[];
  question_format?: string | null;
  mathematical_demand?: boolean | null;
  practical_demand?: boolean | null;
};

type Parsed = {
  profile: string;
  rows: Row[];
  scheme: { q: string; scheme: string; flags?: string[] }[];
};

/** Provenance from the renamer's filename: board-subject-level-year-pNT-QP.json */
function provenance(path: string) {
  const stem = path
    .split("/")
    .pop()!
    .replace(/\.json$/, "")
    .replace(/-(QP|MS)$/, "");
  const m = stem.match(/^([a-z]+)-([a-z-]+)-(gcse|igcse|alevel)-(\d{4}|unknown)-p(\d)([A-Z]?)$/);
  return {
    board: flag("board") ?? m?.[1],
    subject: flag("subject") ?? m?.[2],
    level: flag("level") ?? m?.[3],
    year: flag("year") ?? (m?.[4] === "unknown" ? null : (m?.[4] ?? null)),
    paper: m?.[5] ?? null,
    tier: m?.[6] || null,
  };
}

async function upsert(rows: unknown[]) {
  const res = await fetch(
    `${url}/rest/v1/exam_exemplars` +
      `?on_conflict=board,subject,level,year,paper,tier,question_label`,
    {
      method: "POST",
      headers: {
        apikey: key!,
        ...(key!.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
        "Content-Type": "application/json",
        // merge-duplicates so re-ingesting a paper corrects rows in place;
        // the database invalidates approval if the source content changes.
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) throw new Error(`insert failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string }[];
}

let total = 0;
let skipped = 0;

for (const file of files) {
  const parsed = JSON.parse(await Bun.file(file).text()) as Parsed;
  const p = provenance(file);
  if (!p.board || !p.subject || !p.level) {
    console.error(
      `${file}: cannot tell what paper this is from the filename. ` +
        `Rename it, or pass --board --subject --level.`,
    );
    process.exitCode = 1;
    continue;
  }

  // The scheme is per question at this stage; splitting it across a question's
  // sub-parts is the model's job and has not happened yet. Copying the whole
  // question's scheme onto each part would credit every part with every other
  // part's marks, so it goes on the first part and the rest are left null.
  const schemeFor = new Map(parsed.scheme.map((s) => [s.q, s.scheme]));
  const schemeFlags = new Map(parsed.scheme.map((s) => [s.q, s.flags ?? []]));
  const partCounts = new Map<string, number>();
  for (const row of parsed.rows) partCounts.set(row.q, (partCounts.get(row.q) ?? 0) + 1);
  const seenQuestion = new Set<string>();

  const payload = parsed.rows
    .filter((r) => {
      if (r.prompt && r.prompt.trim().length >= 15) return true;
      skipped += 1;
      return false;
    })
    .map((r) => {
      // Legacy output has a whole-question scheme. Keep it for ingestion work,
      // but prevent generation from treating it as an aligned subpart rubric.
      const first = !seenQuestion.has(r.q);
      seenQuestion.add(r.q);
      const flags = [...new Set([...r.flags, ...(schemeFlags.get(r.q) ?? [])])];
      const alignedScheme = r.mark_scheme?.trim() || null;
      if (!alignedScheme && (partCounts.get(r.q) ?? 0) > 1)
        flags.push("mark scheme needs subpart alignment");
      return {
        board: p.board,
        subject: p.subject,
        level: p.level,
        year: p.year,
        paper: p.paper,
        tier: p.tier,
        question_label: r.label,
        prompt: r.prompt,
        marks: r.marks,
        mark_scheme: alignedScheme ?? (first ? (schemeFor.get(r.q) ?? null) : null),
        options: r.options,
        needs_image: r.flags.includes("needs image"),
        flags,
        shared_context: r.shared_context ?? null,
        specification_version: r.specification_version ?? null,
        source_reference: {
          ...r.source_reference,
          parsed_file: file.split("/").pop(),
          parser_profile: parsed.profile,
        },
        command_word: r.command_word ?? null,
        assessment_objectives: r.assessment_objectives ?? [],
        question_format: r.question_format ?? (r.options ? "mcq" : "written"),
        mathematical_demand: r.mathematical_demand ?? null,
        practical_demand: r.practical_demand ?? null,
      };
    });

  const images = payload.filter((r) => r.needs_image).length;
  const flagged = payload.filter((r) => r.flags.length > 0 && !r.needs_image).length;
  const awaiting = payload.filter((r) => r.mark_scheme === null).length;
  const ready = payload.length - images - flagged;
  console.log(
    `${file}\n  ${p.board}/${p.subject}/${p.level} ${p.year ?? "?"} ` +
      `p${p.paper ?? "?"}${p.tier ?? ""} — ${payload.length} rows\n` +
      `    ${ready} usable, ${images} need an image, ${flagged} flagged\n` +
      `    ${awaiting} awaiting their share of a multi-part mark scheme`,
  );

  if (write) {
    const inserted = await upsert(payload);
    console.log(`  wrote ${inserted.length}`);
  }
  total += payload.length;
}

console.log(
  `\n  ${total} rows${skipped ? `, ${skipped} skipped as too short to be a question` : ""}`,
);
if (!write) console.log("  Preview only. Re-run with --write to insert.");
else console.log("  Complete rows are approved on arrival; flagged ones are held back.");
