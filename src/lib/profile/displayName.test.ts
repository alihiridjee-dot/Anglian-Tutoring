import { describe, expect, test } from "bun:test";
import { cleanName, resolveDisplayName, resolveInitials, sameName } from "./displayName";

describe("resolveDisplayName", () => {
  test("a real name is used as typed", () => {
    expect(resolveDisplayName("  Jamie Doe ", "jamie@x.com")).toBe("Jamie Doe");
  });

  test("an invisible name falls back to the email", () => {
    expect(resolveDisplayName("​", "jamie.doe@x.com")).toBe("Jamie.doe");
    expect(resolveDisplayName("‮​ ﻿", null)).toBe("there");
  });

  test("direction overrides are taken out, so the name can be typed back", () => {
    expect(resolveDisplayName("a‮evil", null)).toBe("aevil");
  });
});

describe("resolveInitials", () => {
  test("first and last word, or the first two letters", () => {
    expect(resolveInitials("Jamie Doe", null)).toBe("JD");
    expect(resolveInitials("test 1", null)).toBe("T1");
    expect(resolveInitials("Jamie", null)).toBe("JA");
    expect(resolveInitials(null, "sam@x.com")).toBe("SA");
  });

  test("an emoji stays whole rather than half a character", () => {
    expect(resolveInitials("😀 Smith", null)).toBe("😀S");
    expect(resolveInitials("😀😀", null)).toBe("😀😀");
  });

  test("an invisible name falls back to the email", () => {
    expect(resolveInitials("​", "jamie@x.com")).toBe("JA");
  });
});

describe("sameName", () => {
  test("case, spacing and invisible characters aside", () => {
    expect(sameName(" jamie  doe ", "Jamie Doe")).toBe(true);
    expect(sameName("aevil", "a‮evil")).toBe(true);
    expect(sameName("Jamie", "Jamie Doe")).toBe(false);
  });

  test("an accent typed either way is the same letter", () => {
    expect(sameName("Zoé", "Zoé")).toBe(true);
  });

  test("an empty or invisible name can't be confirmed by typing nothing", () => {
    expect(sameName("", "​")).toBe(false);
    expect(sameName("", "")).toBe(false);
  });
});

describe("cleanName", () => {
  test("keeps the joiners an emoji or a script needs", () => {
    expect(cleanName("👩‍🔬 Ada")).toBe("👩‍🔬 Ada");
  });

  test("nothing visible left is nothing", () => {
    expect(cleanName("‍")).toBe("");
    expect(cleanName(null)).toBe("");
  });
});
