/**
 * Load parsed exam questions into the exemplar library.
 *
 * Takes rows in the shape split_paper.py `--json` produces and writes them to
 * `exam_exemplars`. Approval is the database's job, not this script's: a row
 * that arrives complete — text, marks, its own mark scheme, no flags, no
 * missing figure — is approved on the way in, and one that does not is held
 * back until a later ingest mends it.
 *
 *   bun run scripts/ingest-paper/load-exemplars.ts papers/*.json          # preview
 *   bun run scripts/ingest-paper/load-exemplars.ts papers/*.json --write  # insert
 *
 * Preview by default — it prints what it would write and touches nothing.
 * Re-running the same paper updates its rows rather than duplicating them.
 *
 * Once a paper's rows are in the database it is filed away: the two PDFs and
 * the JSON move to papers/done/. That is what stops the next `papers/*.json`
 * from reloading everything read so far, and it is how you can tell at a glance
 * which papers are still to do. `--keep` leaves them where they are.
 *
 * Provenance comes from the filename the renamer produced
 * (edexcel-physics-gcse-2018-jun-p1F-QP.pdf), so run these against renamed
 * papers or pass --board/--subject/--level/--series explicitly. The sitting is
 * required: the same paper number is set more than once a year by the
 * international boards, and without it a second sitting would overwrite the
 * first.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: the table is behind
 * tutor-only RLS and this runs outside a session.
 */
import { mkdir, rename } from "node:fs/promises";
import { indexSpecPoints, parsePaperStem, SERIES, type Series } from "./specCodes";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

const args = process.argv.slice(2);
const valueFlags = new Set(["--board", "--subject", "--level", "--year", "--series"]);
const files = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));
const write = args.includes("--write");
const keep = args.includes("--keep");
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
  /** Spec point codes this part credits, without the board prefix: ["1.6"]. */
  spec_points?: string[];
};

type Parsed = {
  profile: string;
  rows: Row[];
  // Only the old parser produced this: a whole question's scheme that it could
  // not divide between the parts. Absent from anything read in a session.
  scheme?: { q: string; scheme: string; flags?: string[] }[];
};

/** Provenance from the renamer's filename: board-subject-level-year-series-pNT-QP.json */
function provenance(path: string) {
  const stem = path
    .split("/")
    .pop()!
    .replace(/\.json$/, "")
    .replace(/-(QP|MS)$/, "");
  const m = parsePaperStem(stem);
  const series = flag("series");
  if (series !== undefined && !(SERIES as readonly string[]).includes(series))
    throw new Error(`--series must be one of ${SERIES.join(", ")}`);
  return {
    board: flag("board") ?? m?.board,
    subject: flag("subject") ?? m?.subject,
    level: flag("level") ?? m?.level,
    year: flag("year") ?? m?.year ?? null,
    series: (series as Series | undefined) ?? m?.series ?? null,
    paper: m?.paper ?? null,
    tier: m?.tier ?? null,
  };
}

async function upsert(rows: unknown[]) {
  const res = await fetch(
    `${url}/rest/v1/exam_exemplars` +
      `?on_conflict=board,subject,level,year,series,paper,tier,question_label`,
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
  return (await res.json()) as { id: string; question_label: string }[];
}

/**
 * Link the rows that name spec points to those points.
 *
 * Which point a question credits is the judgement half of ingestion and the
 * half most worth reviewing: a bad split is obvious, a bad tag is invisible. A
 * code that doesn't exist is reported rather than guessed at, and the rest of
 * the paper still loads — a missing tag costs relevance, never correctness.
 */
async function writeTags(
  rows: Row[],
  inserted: { id: string; question_label: string }[],
  p: { board?: string; level?: string; subject?: string },
): Promise<number> {
  const wanted = rows.filter((r) => r.spec_points?.length);
  if (wanted.length === 0) return 0;

  const res = await fetch(
    `${url}/rest/v1/spec_points?select=id,code,topics!inner(board,level,subject)` +
      `&topics.board=eq.${p.board}&topics.level=eq.${p.level}&topics.subject=eq.${p.subject}`,
    {
      headers: {
        apikey: key!,
        ...(key!.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
      },
    },
  );
  if (!res.ok) throw new Error(`spec point lookup failed: ${res.status} ${await res.text()}`);
  const byCode = indexSpecPoints((await res.json()) as { id: string; code: string }[]);
  const byLabel = new Map(inserted.map((e) => [e.question_label, e.id]));

  const unknown: string[] = [];
  const pairs: { exemplar_id: string; spec_point_id: string }[] = [];
  for (const row of wanted) {
    const exemplarId = byLabel.get(row.label);
    if (!exemplarId) continue;
    for (const code of row.spec_points!) {
      const pointId = byCode.get(code);
      if (!pointId) {
        unknown.push(code);
        continue;
      }
      pairs.push({ exemplar_id: exemplarId, spec_point_id: pointId });
    }
  }
  if (unknown.length) {
    console.error(`  unknown spec point codes: ${[...new Set(unknown)].join(", ")}`);
    process.exitCode = 1;
  }
  if (pairs.length === 0) return 0;

  const headers = {
    apikey: key!,
    ...(key!.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
    "Content-Type": "application/json",
  };
  // Re-ingesting a paper replaces its tags rather than adding to them.
  const ids = [...new Set(pairs.map((t) => t.exemplar_id))];
  for (let i = 0; i < ids.length; i += 100) {
    await fetch(
      `${url}/rest/v1/exam_exemplar_spec_points?exemplar_id=in.(${ids.slice(i, i + 100).join(",")})`,
      { method: "DELETE", headers },
    );
  }
  const write = await fetch(
    `${url}/rest/v1/exam_exemplar_spec_points?on_conflict=exemplar_id,spec_point_id`,
    { method: "POST", headers, body: JSON.stringify(pairs) },
  );
  if (!write.ok) throw new Error(`tag insert failed: ${write.status} ${await write.text()}`);
  return pairs.length;
}

/** Move a loaded paper and its rows out of the way, so what is left in the
 *  folder is what is left to do. Missing halves are not an error: a paper read
 *  from somewhere else has no PDFs here to move. */
async function fileAway(file: string) {
  const stem = file
    .split("/")
    .pop()!
    .replace(/\.json$/, "");
  const moved: string[] = [];
  await mkdir("papers/done", { recursive: true });
  for (const from of [
    file,
    `papers/named/${stem}-QP.pdf`,
    `papers/named/${stem}-MS.pdf`,
    `papers/incoming/${stem}-QP.pdf`,
    `papers/incoming/${stem}-MS.pdf`,
  ]) {
    const name = from.split("/").pop()!;
    try {
      await rename(from, `papers/done/${name}`);
      moved.push(name);
    } catch {
      // Not there. A paper read from somewhere else has no PDFs here to move,
      // and that is not a failure worth stopping a load over.
    }
  }
  return moved;
}

let total = 0;
let skipped = 0;

for (const file of files) {
  const parsed = JSON.parse(await Bun.file(file).text()) as Parsed;
  const p = provenance(file);
  if (!p.board || !p.subject || !p.level) {
    console.error(
      `${file}: cannot tell what paper this is from the filename. ` +
        `Rename it, or pass --board --subject --level --series.`,
    );
    process.exitCode = 1;
    continue;
  }
  if (!p.series) {
    console.error(
      `${file}: which sitting this paper is from is unknown. Check the date on the paper, ` +
        `then rename it or pass --series (${SERIES.join(", ")}).`,
    );
    process.exitCode = 1;
    continue;
  }

  // The scheme is per question at this stage; splitting it across a question's
  // sub-parts is the model's job and has not happened yet. Copying the whole
  // question's scheme onto each part would credit every part with every other
  // part's marks, so it goes on the first part and the rest are left null.
  // Optional: papers read straight into per-part mark schemes carry no separate
  // block, and the legacy whole-question one is only a fallback.
  const scheme = parsed.scheme ?? [];
  const schemeFor = new Map(scheme.map((s) => [s.q, s.scheme]));
  const schemeFlags = new Map(scheme.map((s) => [s.q, s.flags ?? []]));
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
        series: p.series,
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
    `${file}\n  ${p.board}/${p.subject}/${p.level} ${p.series} ${p.year ?? "?"} ` +
      `p${p.paper ?? "?"}${p.tier ?? ""} — ${payload.length} rows\n` +
      `    ${ready} usable, ${images} need an image, ${flagged} flagged\n` +
      `    ${awaiting} awaiting their share of a multi-part mark scheme`,
  );

  const tagged = parsed.rows.filter((r) => r.spec_points?.length).length;
  console.log(
    `    ${tagged} tagged to a spec point` +
      (tagged < payload.length - images
        ? ` — ${payload.length - images - tagged} usable rows carry no tag, so they only ever ground a question by style`
        : ""),
  );

  if (write) {
    const inserted = await upsert(payload);
    console.log(`  wrote ${inserted.length}`);
    // Tags travel with the rows: the reading pass already decided which point
    // each question credits, and a second pass over the same paper would only
    // be a chance to decide differently. `load-tags.ts` exists for corrections
    // and for papers read before tagging was part of this.
    const links = await writeTags(parsed.rows, inserted, p);
    if (links) console.log(`  linked ${links} question/spec point pairs`);
    // Filed away only once its tags are in too, so a paper in papers/done/ is
    // finished rather than half-loaded.
    if (!keep) {
      const moved = await fileAway(file);
      if (moved.length) console.log(`  filed away in papers/done/: ${moved.join(", ")}`);
    }
  }
  total += payload.length;
}

console.log(
  `\n  ${total} rows${skipped ? `, ${skipped} skipped as too short to be a question` : ""}`,
);
if (!write) console.log("  Preview only. Re-run with --write to insert.");
else console.log("  Complete rows are approved on arrival; flagged ones are held back.");
