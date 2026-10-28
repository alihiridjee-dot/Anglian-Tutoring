import { describe, expect, test } from "bun:test";
import { cleanName, resolveDisplayName, resolveInitials, sameName } from "./displayName";

// Written as escapes so a reader can see them: zero-width space, right-to-left
// override, byte-order mark, zero-width joiner, Hangul filler, blank braille cell.
const ZWSP = "\u200B";
const RLO = "\u202E";
const BOM = "\uFEFF";
const ZWJ = "\u200D";
const HANGUL_FILLER = "\u3164";
const BRAILLE_BLANK = "\u2800";
/** The Wales flag: a black flag, then tag letters spelling "gbwls", then an end tag. */
const WALES = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}";

describe("resolveDisplayName", () => {
  test("a real name is used as typed", () => {
    expect(resolveDisplayName("  Jamie Doe ", "jamie@x.com")).toBe("Jamie Doe");
  });

  test("an invisible name falls back to the email", () => {
    expect(resolveDisplayName(ZWSP, "jamie.doe@x.com")).toBe("Jamie.doe");
    expect(resolveDisplayName(`${RLO}${ZWSP} ${BOM}`, null)).toBe("there");
  });

  test("a name of fillers that draw nothing falls back to the email", () => {
    expect(resolveDisplayName(HANGUL_FILLER, "kid@x.com")).toBe("Kid");
    expect(resolveDisplayName(`${BRAILLE_BLANK} ${HANGUL_FILLER}`, "kid@x.com")).toBe("Kid");
  });

  test("direction overrides are taken out, so the name can be typed back", () => {
    expect(resolveDisplayName(`a${RLO}evil`, null)).toBe("aevil");
  });

  test("a home-nation flag keeps its colours", () => {
    expect(resolveDisplayName(`${WALES} Jamie`, null)).toBe(`${WALES} Jamie`);
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
    expect(resolveInitials(`${WALES} Jamie`, null)).toBe(`${WALES}J`);
  });

  test("an invisible name falls back to the email", () => {
    expect(resolveInitials(ZWSP, "jamie@x.com")).toBe("JA");
    expect(resolveInitials(HANGUL_FILLER, "kid@x.com")).toBe("KI");
  });
});

describe("sameName", () => {
  test("case, spacing and invisible characters aside", () => {
    expect(sameName(" jamie  doe ", "Jamie Doe")).toBe(true);
    expect(sameName("aevil", `a${RLO}evil`)).toBe(true);
    expect(sameName("Jamie", "Jamie Doe")).toBe(false);
  });

  test("an accent typed either way is the same letter", () => {
    // e plus a combining acute, against the single letter é.
    expect(sameName("Zoe\u0301", "Zo\u00E9")).toBe(true);
  });

  test("an empty or invisible name can't be confirmed by typing nothing", () => {
    expect(sameName("", ZWSP)).toBe(false);
    expect(sameName("", HANGUL_FILLER)).toBe(false);
    expect(sameName("", "")).toBe(false);
  });
});

describe("cleanName", () => {
  test("keeps the joiners an emoji or a script needs", () => {
    expect(cleanName(`👩${ZWJ}🔬 Ada`)).toBe(`👩${ZWJ}🔬 Ada`);
  });

  test("tag letters outside a flag are taken out", () => {
    expect(cleanName("Ada\u{E0041}\u{E0042}")).toBe("Ada");
  });

  test("nothing visible left is nothing", () => {
    expect(cleanName(ZWJ)).toBe("");
    expect(cleanName(null)).toBe("");
  });
});
