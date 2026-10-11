import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Stored question text must reach the page with the layout it was written
 * with: a key or a method's steps one item per line, a table as a table.
 * SciText draws the lines and SciBlock the tables (both in Shared.tsx), so
 * no page puts that text on screen raw, and no page shows a quiz or task
 * question through SciText, where a table would be drawn as " | " text.
 */
const src = join(import.meta.dir, "..");
const files = [...new Glob("**/*.tsx").scanSync({ cwd: src })]
  .filter((f) => !f.endsWith(".test.tsx"))
  .map((f) => ({ file: f, code: readFileSync(join(src, f), "utf8") }));

/** Every match of `pattern`, as "file: match". */
const found = (pattern: RegExp) =>
  files.flatMap(({ file, code }) => [...code.matchAll(pattern)].map((m) => `${file}: ${m[0]}`));

describe("stored question text keeps its layout on every page", () => {
  test("no page puts a question, answer, explanation or feedback on screen raw", () => {
    // `{q.question}` as a child: not `value={...}` handed to an input, nor
    // `${...}` inside a template string.
    const raw = found(
      /(?<![=\w$])\{\s*[\w.?!]+\.(question|prompt|explanation|mark_scheme|answer_text|feedback)\s*\}/g,
    ).filter(
      // The sign-up's own questions ("How do you like to learn?"): wording, not stored text.
      (m) => !m.startsWith("routes/onboarding/learning.tsx:"),
    );
    expect(raw).toEqual([]);
  });

  test("a quiz or task question is drawn by SciBlock, so its tables are tables", () => {
    const viaSciText = found(/<SciText\s+text=\{[\w.?!]+\.(question|prompt)\}/g).filter(
      (m) =>
        // A one-line question idea for a chat message, inside a button's label.
        !m.startsWith("components/chat/NewThreadDialog.tsx:") &&
        // A note diagram's instruction ("Pick a salt solution").
        m !== "components/notes/NoteView.tsx: <SciText text={d.prompt}",
    );
    expect(viaSciText).toEqual([]);
  });

  test("the pages that show questions draw them with SciBlock", () => {
    const uses = (file: string, snippet: string) =>
      files.find((f) => f.file === file)?.code.includes(snippet) ?? false;
    expect(uses("components/mcq/TakeMcqPage.tsx", "<SciBlock")).toBe(true);
    expect(uses("components/BuiltInHomework.tsx", "<SciBlock")).toBe(true);
    expect(uses("components/tutor/AnswerMarking.tsx", "<SciBlock")).toBe(true);
    expect(uses("components/notes/NoteView.tsx", "<SciBlock")).toBe(true);
  });
});
