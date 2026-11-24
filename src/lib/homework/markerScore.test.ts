import { describe, expect, test } from "bun:test";
import {
  stageMarks,
  withoutScore,
  type Question,
} from "../../../supabase/functions/mark-homework/marker";

/**
 * The score a student sees is worked out from the marks. The marker's words
 * must never state one of their own: on 24 Nov a summary said "19 out of 22"
 * beside 82%, because the evidence check had taken a mark away after the words
 * were written.
 */

const question = (id: string, marks: number): Question => ({
  id,
  position: 0,
  prompt: "Describe it.",
  marks,
  answer_type: "text",
  mark_scheme: null,
});

describe("the summary never states a score", () => {
  test("a score sentence is taken out, the rest kept", () => {
    expect(
      withoutScore(
        "You scored 19 out of 22 on this task. You clearly know the three radiations. Keep it up!",
      ),
    ).toBe("You clearly know the three radiations. Keep it up!");
  });

  test("a slash score goes too", () => {
    expect(withoutScore("Great work, 18/22. Next, learn the charges.")).toBe(
      "Next, learn the charges.",
    );
  });

  test("science with numbers in it stays", () => {
    const text = "Light travels at 3 × 10⁸ m/s. You used that well.";
    expect(withoutScore(text)).toBe(text);
  });
});

describe("a mark taken down by the evidence check", () => {
  test("is held, with a note to check the comment, and the summary loses its score", () => {
    const staged = stageMarks(
      [question("q1", 4)],
      new Map([["q1", "93 protons and 144 neutrons. Alpha has charge, gamma has none."]]),
      {
        questions: [
          {
            question_id: "q1",
            marks: 4,
            feedback: "Full marks, well done!",
            credited: [
              { quote: "93 protons", point: "protons", marks: 1 },
              { quote: "144 neutrons", point: "neutrons", marks: 1 },
              { quote: "gamma has none", point: "charge", marks: 1 },
            ],
            unsure: "",
          },
        ],
        summary: "You scored 4 out of 4 on this task. Lovely work on the nucleus.",
      },
    );

    expect(staged.questions[0].marks).toBe(3);
    expect(staged.questions[0].held).toContain("The comment was written for 4 marks");
    expect(staged.summary).toBe("Lovely work on the nucleus.");
  });
});
