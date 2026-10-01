import { describe, expect, test } from "bun:test";
import { whatsappLink } from "./whatsapp";

describe("whatsappLink", () => {
  test("a long message with an emoji at the cut still makes a link", () => {
    // 899 letters, then an emoji (two UTF-16 units) straddling the 900th unit.
    const message = "a".repeat(899) + "🧪" + " and more after the cut";
    const link = whatsappLink(message);
    const text = decodeURIComponent(new URL(link).searchParams.get("text") ?? "");
    expect(text).toBe("a".repeat(899) + "🧪");
  });

  test("a short message is passed through whole", () => {
    const link = whatsappLink("  Hi, is there a GCSE Physics group?  ");
    expect(new URL(link).searchParams.get("text")).toBe("Hi, is there a GCSE Physics group?");
  });

  test("no message, no text parameter", () => {
    expect(whatsappLink("   ")).not.toContain("?text=");
  });
});
