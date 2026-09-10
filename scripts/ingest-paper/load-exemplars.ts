/**
 * Load parsed exam questions into the exemplar library.
 *
 * Takes the `--json` output of split_paper.py and writes it to
 * `exam_exemplars`. Rows arrive unapproved: nothing generated or marked reads
 * them until a tutor has said so, because everything downstream copies them.
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
const files = args.filter((a) => !a.startsWith("--"));
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
};

type Parsed = { profile: string; rows: Row[]; scheme: { q: string; scheme: string }[] };

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
        // approval state lives in columns we do not send, so a tutor's decision
        // is not undone by a re-run.
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
  const seenQuestion = new Set<string>();

  const payload = parsed.rows
    .filter((r) => {
      if (r.prompt && r.prompt.trim().length >= 15) return true;
      skipped += 1;
      return false;
    })
    .map((r) => {
      // A null mark_scheme already means "not attached yet", so there is no
      // need to flag it as well — flags are for things that went wrong, and
      // filling them with a normal intermediate state hides the real ones.
      const first = !seenQuestion.has(r.q);
      seenQuestion.add(r.q);
      const flags = [...r.flags];
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
        mark_scheme: first ? (schemeFor.get(r.q) ?? null) : null,
        options: r.options,
        needs_image: r.flags.includes("needs image"),
        flags,
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
else console.log("  All rows are unapproved until a tutor approves them.");
