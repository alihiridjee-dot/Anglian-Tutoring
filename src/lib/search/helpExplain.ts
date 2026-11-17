import type { Note, NoteBlock } from "@/lib/notes/noteFormat";
import { toSciNotation } from "@/lib/platform/sciNotation";

// A science question typed into the help box is answered from one of our own
// revision notes: the note goes to the model as the only source it may use,
// and what comes back is checked here before a student sees it. Pure, so the
// server function and its tests agree on the rules.

/** Most of a note the model is shown. A whole note is usually well under this. */
export const MAX_NOTE_CHARS = 8000;

/** Longest answer shown. Past this the model is writing an essay, not an answer. */
export const MAX_ANSWER_CHARS = 700;

const plain = (text: string) => text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

function blockText(block: NoteBlock): string[] {
  switch (block.type) {
    case "paragraph":
    case "subheading":
      return [plain(block.text)];
    case "list":
    case "key-points":
      return block.items.map((item) => `- ${plain(item)}`);
    case "definitions":
      return block.items.map((d) => `- ${plain(d.term)}: ${plain(d.meaning)}`);
    case "equation":
      return [
        [block.label, block.formula].filter(Boolean).join(": "),
        ...(block.where ?? []).map((w) => `  where ${plain(w)}`),
      ];
    case "steps":
      return block.items.map((s, i) => `${i + 1}. ${plain(s.lead)} ${plain(s.text)}`);
    case "table":
      return [block.columns.join(" | "), ...block.rows.map((r) => r.map(plain).join(" | "))];
    // A picture has no words worth sending.
    case "diagram":
      return [];
  }
}

/** A note as plain text: its key idea and every section, pictures left out. */
export function noteText(note: Note): string {
  const lines = [note.title, plain(note.key_idea)];
  for (const section of note.sections ?? []) {
    lines.push("", `## ${plain(section.heading)}`);
    for (const block of section.blocks ?? []) lines.push(...blockText(block));
  }
  return lines.join("\n").slice(0, MAX_NOTE_CHARS);
}

/**
 * The model's answer, or null when there is none worth showing: the note
 * didn't cover the question (the model is told to say so with null), the
 * reply isn't the JSON asked for, or it is too short or too long to be one.
 */
export function parseExplainReply(text: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const answer = (raw as { answer?: unknown } | null)?.answer;
  if (typeof answer !== "string") return null;
  const clean = plain(answer.replace(/[#`]/g, ""));
  if (clean.length < 20 || clean.length > MAX_ANSWER_CHARS) return null;
  return toSciNotation(clean);
}
