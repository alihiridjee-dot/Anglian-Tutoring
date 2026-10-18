/**
 * Write the triage pack a GCSE layer writer reads: per concept, the GCSE spec
 * points of each board (with Higher-tier and separate-science flags) next to
 * everything the note already says, plus a word-match score per point.
 *
 *   bun scripts/notes/gcse-layers/slim-pack.ts <subject> [concept id ...]
 *
 * Needs the full packs (build-sources.ts) first. Writes
 * scripts/notes/.sources/triage/gcse/<id>.md and a coverage table
 * _coverage-<subject>.tsv next to them (all gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const [subject, ...only] = process.argv.slice(2);
if (!subject) throw new Error("Usage: slim-pack.ts <subject> [ids]");
const map = JSON.parse(readFileSync(join(ROOT, "scripts/notes/concepts", `gcse-${subject}.json`), "utf8"));
const outDir = join(ROOT, "scripts/notes/.sources/triage/gcse");
mkdirSync(outDir, { recursive: true });

const STOP = new Set(
  "the and that with from this into than then they them their there these those when where which while will would should could about above below between under over after before being been have has had does doing done each other some such only also more most very just like make made using used use able students student should know knowledge understand understanding describe explain recall state give apply including include includes to include limited required practical activity activities example examples following simple terms term may might must need needs both either neither through during within without across along because therefore however whether given value values data different same common".split(
    /\s+/,
  ),
);
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
const stem = (w: string) => w.replace(/(ing|ed|es|s|ly|ity|ies)$/, "");

function flatten(blocks: any[], out: string[]) {
  for (const b of blocks ?? []) {
    switch (b.type) {
      case "paragraph":
        out.push(b.text);
        break;
      case "subheading":
        out.push(`### ${b.text}`);
        break;
      case "list":
        for (const i of b.items) out.push(`- ${i}`);
        break;
      case "definitions":
        for (const d of b.items) out.push(`- **${d.term}**: ${d.meaning}`);
        break;
      case "equation":
        out.push(
          `EQUATION ${b.label ? b.label + ": " : ""}${b.formula}${b.where ? " (" + b.where.join("; ") + ")" : ""}`,
        );
        break;
      case "key-points":
        out.push(`Key points: ${b.items.join(" | ")}`);
        break;
      case "steps":
        for (const s of b.items) out.push(`${s.lead} ${s.text}`);
        break;
      case "table":
        out.push(`TABLE ${b.columns.join(" | ")}`);
        for (const r of b.rows) out.push(`  ${r.join(" | ")}`);
        break;
      case "diagram": {
        const d = b.diagram;
        const bits: string[] = [`DIAGRAM (${d.kind}): ${d.alt}`];
        if (d.options)
          for (const o of d.options)
            bits.push(`  ${o.label}: ${o.results.join(" / ")}${o.explanation ? " — " + o.explanation : ""}`);
        if (d.parts) for (const p of d.parts) bits.push(`  ${p.name}: ${p.detail}`);
        if (d.items && d.groups)
          bits.push(`  groups ${d.groups.join(" | ")}: ${d.items.map((i: any) => i.text).join("; ")}`);
        if (d.steps) bits.push(`  ${d.steps.join(" → ")}`);
        if (d.rows) for (const r of d.rows) bits.push(`  ${r.feature}: ${r.values.join(" | ")}`);
        if (d.outputs) bits.push(`  outputs: ${d.outputs.map((o: any) => `${o.label} = ${o.formula}`).join("; ")}`);
        if (d.question) bits.push(`  ${d.question} → ${d.answer?.formula}`);
        out.push(...bits);
        break;
      }
    }
  }
}
const htOf = (title: string, desc: string) => {
  const t = `${title}\n${desc}`;
  const part = t.match(/\(HT only:\s*([^)]*)\)/i);
  if (part) return `HIGHER TIER (part only: "${part[1].trim()}")`;
  if (/\(HT only\)|,\s*HT\)/i.test(t)) return "HIGHER TIER (whole point)";
  return "";
};
const rows: string[] = [];
for (const c of map.concepts) {
  if (only.length && !only.includes(c.id)) continue;
  const packPath = join(ROOT, "scripts/notes/.sources", `${c.id}.json`);
  const draftPath = join(ROOT, "scripts/notes/drafts", subject, `${c.id}.json`);
  if (!existsSync(packPath) || !existsSync(draftPath)) {
    console.log(`skip ${c.id}: missing pack or draft`);
    continue;
  }
  const pack = JSON.parse(readFileSync(packPath, "utf8"));
  const note = JSON.parse(readFileSync(draftPath, "utf8"));
  const shared: string[] = [`# ${note.title}`, `Key idea: ${note.key_idea}`];
  for (const s of note.sections) {
    shared.push(`## ${s.heading}`);
    flatten(s.blocks, shared);
  }
  shared.push("## Checks");
  for (const q of note.checks) shared.push(`Q: ${q.q} A: ${q.a}`);
  const sharedText = shared.join("\n");
  const sharedWords = new Set(words(sharedText).map(stem));
  const md: string[] = [
    `# ${c.id} — ${c.title}`,
    ``,
    `Scope: ${c.scope}`,
    c.higher_only ? `Concept is Higher tier only.` : ``,
    c.separate_only ? `Concept is separate science only.` : ``,
    ``,
    `Read this file top to bottom. Part 1 is what the note already says to every board (do not repeat it). Part 2 lists, board by board, what that board's spec points ask for, with the board's existing layer. For each point, decide what it asks for that Part 1 and the layer lack; those items go in the adds file.`,
    ``,
    `## Part 1 — what the shared note already says`,
    ``,
    sharedText,
    ``,
  ];
  for (const b of ["aqa", "edexcel", "ocr"]) {
    const slot = pack.boards[b];
    if (!slot) continue;
    const layer = note.boards?.[b];
    const layerText: string[] = [];
    if (layer?.worked_example)
      layerText.push(
        `Worked example in this layer: ${layer.worked_example.question} → ${layer.worked_example.answer_points.join(" / ")}`,
      );
    if (layer?.extra?.length)
      for (const e of layer.extra) {
        layerText.push(`Existing extra section "${e.heading}":`);
        flatten(e.blocks, layerText);
      }
    const layerWords = new Set([...sharedWords, ...words(layerText.join("\n")).map(stem)]);
    md.push(`## Part 2 — ${b.toUpperCase()} layer (\`boards.${b}\`)`, ``);
    md.push(
      layer
        ? layerText.length
          ? layerText.join("\n")
          : `This layer has spec codes${layer.worked_example ? " and a worked example" : ""} only, no extra sections.`
        : `NO ${b} LAYER EXISTS in the draft (report this; do not create one).`,
      ``,
    );
    md.push(`### Spec points for this board`, ``);
    const pts = [...slot.spec_points].sort((x: any, y: any) => Number(y.primary) - Number(x.primary));
    const hasTrilogy = (pack.boards.aqa?.spec_points ?? []).some((q: any) => q.course === "aqa_trilogy");
    for (const p of pts) {
      const desc = p.description ?? "";
      const title = p.title ?? "";
      const ht = htOf(title, desc);
      const flags: string[] = [p.primary ? "primary" : "also covered here (non-primary)"];
      if (ht) flags.push(ht);
      if (b === "edexcel" && /\d[PBC]$/.test(p.code)) flags.push("SEPARATE SCIENCE ONLY (code ends in P/B/C)");
      if (b === "aqa" && p.course === "aqa") {
        const myTwin = (pack.boards.aqa.spec_points as any[]).some(
          (q) => q.course === "aqa_trilogy" && (q.title ?? "") === title,
        );
        if (hasTrilogy && !myTwin) flags.push("probably SEPARATE SCIENCE ONLY (no Trilogy twin in this concept)");
        if (/physics only|chemistry only|biology only/i.test(`${title} ${desc}`))
          flags.push("SEPARATE SCIENCE ONLY (says 'physics/chemistry/biology only')");
      }
      if (b === "aqa" && p.course === "aqa_trilogy") flags.push("Trilogy (combined) course point");
      const w = words(desc).map(stem);
      const hit = w.filter((x) => layerWords.has(x)).length;
      const cover = w.length ? hit / w.length : 1;
      if (cover < 0.5) flags.push(`PRIORITY: only ${Math.round(cover * 100)}% of its words appear in the note`);
      rows.push(`${c.id}\t${b}\t${p.code}\t${p.primary ? "P" : "-"}\t${Math.round(cover * 100)}%\t${ht ? "HT" : ""}`);
      md.push(`#### ${p.code} — ${title}`, `Flags: ${flags.join("; ")}`, ``, desc.trim() || "(no description)", ``);
    }
  }
  md.push(
    `## Part 3 — the pack`,
    ``,
    `The full pack with this concept's past questions and mark schemes is scripts/notes/.sources/${c.id}.json (large). Read a board's questions only when a point's wording is unclear and the mark scheme would settle what examiners want.`,
  );
  writeFileSync(join(outDir, `${c.id}.md`), md.join("\n"));
}
const outTsv = join(outDir, `_coverage-${subject}.tsv`);
writeFileSync(outTsv, "concept\tboard\tcode\tprimary\tcover\tht\n" + rows.join("\n") + "\n");
const low = rows.filter((r) => parseInt(r.split("\t")[4]) < 50);
const byBoard: Record<string, number> = {};
for (const r of low) {
  const b = r.split("\t")[1];
  byBoard[b] = (byBoard[b] ?? 0) + 1;
}
console.log(
  `${subject}: ${rows.length} GCSE points scored; under half covered: ${low.length} (${JSON.stringify(byBoard)}). Table: ${outTsv}`,
);
