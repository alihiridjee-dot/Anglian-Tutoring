import "@tanstack/react-start/server-only";
import * as chem from "openchemlib";
import { skeletalBrief } from "./structure";

/**
 * A figure brief the writer sent, with a skeletal formula laid out. The
 * writer gives only the molecule's SMILES; where each atom and bond is drawn
 * is worked out here, on the server, so the figure kind that reads, draws and
 * checks it needs no chemistry library. SMILES that does not read is left as
 * it came, and the kind's own `read` then refuses it.
 */
function laidOut(brief: unknown): unknown {
  const b = brief as { kind?: unknown; smiles?: unknown } | null;
  if (!b || b.kind !== "skeletal-formula" || typeof b.smiles !== "string") return brief;
  const laid = skeletalBrief(chem, b.smiles);
  return "brief" in laid ? laid.brief : { kind: b.kind, smiles: b.smiles };
}

/** A field holding a brief, or an array of briefs, as JSON text: the same with each skeletal formula laid out. */
function laidOutField(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.includes("skeletal-formula")) return raw;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return raw;
  }
  return JSON.stringify(Array.isArray(value) ? value.map(laidOut) : laidOut(value));
}

/**
 * Lay out every skeletal formula in a writer's reply, in place, before its
 * questions are checked: a question's `figure` and its `option_figures`.
 */
export function layOutStructures(reply: unknown): void {
  const questions = (reply as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return;
  for (const q of questions) {
    if (!q || typeof q !== "object") continue;
    const r = q as Record<string, unknown>;
    if ("figure" in r) r.figure = laidOutField(r.figure);
    if ("option_figures" in r) r.option_figures = laidOutField(r.option_figures);
  }
}
