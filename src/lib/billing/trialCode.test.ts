import { describe, expect, test } from "bun:test";
import {
  buildTrialEmail,
  canonicalEmail,
  makeTrialCode,
  normaliseTrialCode,
  TRIAL_DAYS,
} from "../../../supabase/functions/_shared/trialCode";
import { TRIAL_DAYS as CLIENT_TRIAL_DAYS } from "./trialCode";

describe("makeTrialCode", () => {
  test("is AE- and two groups of four, from characters that can't be misread", () => {
    const code = makeTrialCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toBe("AE-ABCD-EFGH");
    for (let i = 0; i < 200; i++) {
      const random = makeTrialCode(crypto.getRandomValues(new Uint8Array(8)));
      expect(random).toMatch(/^AE-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(random.slice(3)).not.toMatch(/[01OIL]/);
    }
  });

  test("refuses too few bytes rather than making a short code", () => {
    expect(() => makeTrialCode(new Uint8Array(4))).toThrow();
  });
});

describe("normaliseTrialCode", () => {
  test("forgives case, spaces and missing dashes", () => {
    expect(normaliseTrialCode("ae-k7qm-3xpd")).toBe("AE-K7QM-3XPD");
    expect(normaliseTrialCode(" AE K7QM 3XPD ")).toBe("AE-K7QM-3XPD");
    expect(normaliseTrialCode("K7QM3XPD")).toBe("AE-K7QM-3XPD");
  });

  test("a code whose own characters start AE is not mistaken for the prefix", () => {
    expect(normaliseTrialCode("AEK7QM3X")).toBe("AE-AEK7-QM3X");
    expect(normaliseTrialCode("AE-AEK7-QM3X")).toBe("AE-AEK7-QM3X");
  });

  test("rejects anything that can't be a code", () => {
    expect(normaliseTrialCode("")).toBeNull();
    expect(normaliseTrialCode("AE-K7QM")).toBeNull();
    expect(normaliseTrialCode("AE-K7QM-3XP0")).toBeNull(); // 0 is never issued
    expect(normaliseTrialCode(42)).toBeNull();
    expect(normaliseTrialCode(undefined)).toBeNull();
  });
});

describe("buildTrialEmail", () => {
  const email = buildTrialEmail("AE-K7QM-3XPD", "https://angliaeducate.co.uk");

  test("carries the code and a sign-up link that fills it in", () => {
    const link = "https://angliaeducate.co.uk/auth?mode=signup&trial=AE-K7QM-3XPD";
    expect(email.text).toContain("AE-K7QM-3XPD");
    expect(email.text).toContain(link);
    expect(email.html).toContain(link.replace("&", "&amp;"));
  });

  test("says a card is taken but nothing is charged during the trial", () => {
    expect(email.text).toContain(`nothing is taken for ${TRIAL_DAYS} days`);
  });
});

test("the plan page promises the same trial length the server grants", () => {
  expect(CLIENT_TRIAL_DAYS).toBe(TRIAL_DAYS);
});

describe("canonicalEmail", () => {
  test("Gmail's dots, plus-tags and googlemail.com are one mailbox", () => {
    for (const variant of [
      "name@gmail.com",
      "Name@Gmail.com",
      " n.a.m.e@gmail.com ",
      "name+trial@gmail.com",
      "na.me+2@googlemail.com",
    ]) {
      expect(canonicalEmail(variant)).toBe("name@gmail.com");
    }
  });

  test("a plus-tag is dropped anywhere, but dots only matter at Gmail", () => {
    expect(canonicalEmail("sam+school@outlook.com")).toBe("sam@outlook.com");
    expect(canonicalEmail("first.last@outlook.com")).toBe("first.last@outlook.com");
  });

  test("an address that is all tag keeps its name rather than becoming empty", () => {
    expect(canonicalEmail("+x@gmail.com")).toBe("+x@gmail.com");
  });
});
