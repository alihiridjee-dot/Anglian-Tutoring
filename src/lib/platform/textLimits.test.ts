import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ANSWER_MAX,
  CHAT_MESSAGE_MAX,
  CHECKIN_NOTE_MAX,
  DISPLAY_NAME_MAX,
  FEEDBACK_MAX,
  INVISIBLE_CHARS,
  isBlank,
  PHONE_MAX,
  SCHOOL_MAX,
} from "./textLimits";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20261028110000_size_and_flood_limits.sql", import.meta.url),
  "utf8",
);

/** The number a named check in the migration allows. */
function checkLimit(constraint: string): number {
  const m = migration.match(
    new RegExp(`add constraint ${constraint}\\s+check \\(char_length\\(\\w+\\) <= (\\d+)\\)`),
  );
  if (!m) throw new Error(`No length check named ${constraint}`);
  return Number(m[1]);
}

describe("each box stops where the database does", () => {
  test("task answers", () => {
    expect(checkLimit("homework_answers_answer_text_length")).toBe(ANSWER_MAX);
    // A draft answer has the same limit, and the hand-in says it in words.
    expect(migration).toContain(`char_length(e.value #>> '{}') > ${ANSWER_MAX}`);
    expect(migration).toContain(
      `char_length(btrim(coalesce(a ->> 'answer_text', ''))) > ${ANSWER_MAX}`,
    );
    expect(migration).toContain("Each answer can be up to 5,000 characters.");
  });

  test("chat messages", () => {
    expect(checkLimit("chat_messages_body_length")).toBe(CHAT_MESSAGE_MAX);
  });

  test("profile fields", () => {
    expect(checkLimit("profiles_display_name_length")).toBe(DISPLAY_NAME_MAX);
    expect(checkLimit("profiles_phone_length")).toBe(PHONE_MAX);
    expect(checkLimit("profiles_school_length")).toBe(SCHOOL_MAX);
  });

  test("the weekly note", () => {
    expect(checkLimit("student_weekly_checkins_reflection_length")).toBe(CHECKIN_NOTE_MAX);
  });

  test("the plan feedback note", () => {
    expect(checkLimit("billing_feedback_reason_length")).toBe(FEEDBACK_MAX);
  });

  test("the chat subject box (maxLength 140) fits under the database's 200", () => {
    expect(checkLimit("chat_threads_subject_line_length")).toBeGreaterThanOrEqual(140);
  });
});

describe("a blank answer", () => {
  test("is found with the same characters as the hand-in", () => {
    expect(migration).toContain(`'${INVISIBLE_CHARS}'`);
  });

  test("nothing, spaces and line breaks", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("  \n\t ")).toBe(true);
  });

  test("invisible characters that trim() keeps", () => {
    expect("\u200b\u200b".trim()).not.toBe("");
    expect(isBlank("\u200b\u200b")).toBe(true);
    expect(isBlank("\ufeff\u2060\u200f\u202e")).toBe(true);
    expect(isBlank("\u00a0\u3000")).toBe(true);
    // An Arabic letter mark is a direction mark like U+200F.
    expect(isBlank("\u061c")).toBe(true);
    // The database's own idea of a space includes these; the list says so.
    expect(isBlank("\u0085\u001c\u001f")).toBe(true);
  });

  test("other format characters count as an answer, as on the server", () => {
    expect(isBlank("\u{e0041}")).toBe(false);
    expect(isBlank("\u0600")).toBe(false);
  });

  test("anything a reader can see is an answer", () => {
    expect(isBlank("H2O")).toBe(false);
    expect(isBlank("H\u200bO")).toBe(false);
    expect(isBlank("-")).toBe(false);
    expect(isBlank(".")).toBe(false);
  });
});
