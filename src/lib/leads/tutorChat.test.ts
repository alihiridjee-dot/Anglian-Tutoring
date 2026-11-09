import { describe, expect, test } from "bun:test";
import { AI_REPLIES, cleanReply, handoffText, validateTutorChat } from "./tutorChat";

const parent = (text: string) => ({ from: "parent", text });
const tutor = (text: string) => ({ from: "tutor", text });

describe("validateTutorChat", () => {
  test("a first question passes, contact details taken out", () => {
    const { tutor: who, turns } = validateTutorChat({
      tutor: "nadia",
      turns: [parent("I'm sam@example.com, call 07700 900123 about GCSE Biology")],
    });
    expect(who).toBe("nadia");
    expect(turns[0].text).toBe("I'm [email], call [number] about GCSE Biology");
  });

  test(`the ${AI_REPLIES}rd question is the last one answered`, () => {
    const turns = [parent("a"), tutor("b"), parent("c"), tutor("d"), parent("e")];
    expect(validateTutorChat({ tutor: "ali", turns }).turns).toHaveLength(5);
    expect(() =>
      validateTutorChat({ tutor: "ali", turns: [...turns, tutor("f"), parent("g")] }),
    ).toThrow();
  });

  test("an unknown tutor, out-of-order turns or an empty question are refused", () => {
    expect(() => validateTutorChat({ tutor: "bob", turns: [parent("hi")] })).toThrow();
    expect(() => validateTutorChat({ tutor: "ali", turns: [tutor("hi")] })).toThrow();
    expect(() => validateTutorChat({ tutor: "ali", turns: [parent("a"), tutor("b")] })).toThrow();
    expect(() => validateTutorChat({ tutor: "ali", turns: [parent("   ")] })).toThrow();
    expect(() => validateTutorChat({ tutor: "ali", turns: [] })).toThrow();
  });

  test("a long message is cut to length", () => {
    const { turns } = validateTutorChat({ tutor: "ali", turns: [parent("word ".repeat(400))] });
    expect(turns[0].text.length).toBeLessThanOrEqual(500);
  });
});

describe("handoffText", () => {
  test("no questions: the usual greeting", () => {
    expect(handoffText("Nadia", [])).toBe(
      "Hi Nadia! I saw your profile on the Anglia Educate site.",
    );
  });

  test("one question follows the greeting", () => {
    expect(handoffText("Ali", [], "Do you teach OCR?")).toBe(
      "Hi Ali! I saw your profile on the Anglia Educate site.\n\nDo you teach OCR?",
    );
  });

  test("several questions come as a list", () => {
    expect(handoffText("Nadia", ["How much?", "Which boards?"])).toBe(
      "Hi Nadia! I saw your profile on the Anglia Educate site. Carrying on from our chat there:\n\n• How much?\n• Which boards?",
    );
  });
});

describe("cleanReply", () => {
  test("markdown that slips through is removed", () => {
    expect(cleanReply("**Yes!** We teach:\n- AQA\n- OCR")).toBe("Yes! We teach: AQA OCR");
  });
});
