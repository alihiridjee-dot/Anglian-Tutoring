import { describe, expect, test } from "bun:test";
import { TOUR_STEPS } from "./tourSteps";

describe("the demo tour's copy", () => {
  const copy = TOUR_STEPS.map((s, i) => ({ step: i + 1, text: `${s.title} ${s.body}` }));

  test("says task, never homework", () => {
    expect(copy.filter((c) => /homework/i.test(c.text))).toEqual([]);
  });

  test("promises nothing the product doesn't have", () => {
    // Live lessons keep no recordings, and handing in is something students do.
    expect(copy.filter((c) => /record|nothing to (print or )?hand in/i.test(c.text))).toEqual([]);
  });
});
