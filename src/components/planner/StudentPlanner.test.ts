import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The student planner colours itself from the kit (`tint-*` on an ancestor),
// so a raw Tailwind palette class or a `dark:` token anywhere in it is a
// surface that has opted out of the system (README, "Everything colours itself
// from --tint"). The pattern is the one the 18 Nov audit used.
const PALETTE =
  /\b(bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|shadow|divide|accent|caret)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3}/;

describe("StudentPlanner", () => {
  const source = readFileSync(new URL("./StudentPlanner.tsx", import.meta.url), "utf8");

  test("names no Tailwind palette colour", () => {
    expect(source.match(PALETTE)?.[0] ?? null).toBeNull();
  });

  test("has no dark: tokens (the site is light-mode only)", () => {
    expect(source.match(/\bdark:[\w[]/)?.[0] ?? null).toBeNull();
  });
});
