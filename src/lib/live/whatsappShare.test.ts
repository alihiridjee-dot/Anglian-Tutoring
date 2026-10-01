import { describe, expect, test } from "bun:test";
import {
  scheduledInviteText,
  ukSessionTime,
  whatsAppGroupShareLink,
  whatsAppNumber,
  whatsAppShareLink,
} from "./whatsappShare";

const session = {
  title: "Mole calculations",
  subject: "chemistry",
  level: "gcse_trilogy",
  // 4 pm in London (BST), whatever the sender's own clock says.
  starts_at: "2026-10-08T15:00:00Z",
  join_url: "https://zoom.us/j/1",
};
const textOf = (link: string) => decodeURIComponent(new URL(link).searchParams.get("text")!);
// ICU words the joint differently by runtime ("Thu 8 Oct, 16:00" or "… at 16:00"),
// so check the parts that matter: the day, the UK hour and the label.
const saysUkTime = (text: string, day: string, hour: string) => {
  expect(text).toContain(day);
  expect(text).toContain(`${hour} (UK time)`);
};

describe("whatsAppNumber", () => {
  test("a UK number typed with its leading 0 loses it after 44", () => {
    expect(whatsAppNumber("+44", "07123 456789")).toBe("447123456789");
    expect(whatsAppNumber("+44", "7123456789")).toBe("447123456789");
  });

  test("spaces and stray characters are dropped", () => {
    expect(whatsAppNumber("+44", "  7123 456 789 ")).toBe("447123456789");
  });

  test("a field of only spaces is no number at all", () => {
    expect(whatsAppNumber("+44", "   ")).toBeNull();
    expect(whatsAppNumber("+44", "")).toBeNull();
    expect(whatsAppNumber("+44", "0")).toBeNull();
  });
});

describe("the session text", () => {
  test("states the time in UK time and says so", () => {
    saysUkTime(ukSessionTime(session.starts_at), "Thu 8 Oct", "16:00");
    // GMT in winter: the same UTC hour is 3 pm in London.
    saysUkTime(ukSessionTime("2026-12-03T15:00:00Z"), "Thu 3 Dec", "15:00");
    expect(ukSessionTime(null)).toBe("");
  });

  test("names the level and subject in words, not enum values", () => {
    const text = textOf(whatsAppGroupShareLink(session));
    expect(text).toContain("Chemistry · GCSE Combined Science (Trilogy)");
    expect(text).not.toContain("GCSE_TRILOGY");
    saysUkTime(text, "Thu 8 Oct", "16:00");
    expect(scheduledInviteText(session)).toContain("Chemistry · GCSE Combined Science (Trilogy)");
  });

  test("the reminder opens the student's own chat, and only once a number is typed", () => {
    expect(whatsAppShareLink(session, "+44", "   ")).toBeNull();
    const link = whatsAppShareLink(session, "+44", "07123 456789")!;
    expect(new URL(link).pathname).toBe("/447123456789");
    expect(textOf(link)).toContain("(UK time)");
  });
});
