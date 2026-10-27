import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CIRCUIT_SYMBOLS, FIGURE_CLASSES } from "./figure";
import { figurePromptDoc } from "./figureDoc";
import { FIGURE_PROMPT, FIGURE_REQUEST, figureMessages, retryMessage } from "./figurePrompt";
import { checkFigure } from "./figureCheck";

describe("the DeepSeek figure prompt", () => {
  test("the document is the prompt as sent: run `bun scripts/figure-trial.ts doc` after changing it", () => {
    const doc = readFileSync(
      join(import.meta.dir, "../../../docs/prompts/deepseek-figure-prompt.md"),
      "utf8",
    );
    expect(doc).toBe(figurePromptDoc());
  });

  test("it names every style class and copies every circuit symbol the checker allows", () => {
    for (const c of Object.keys(FIGURE_CLASSES)) expect(FIGURE_PROMPT).toContain(c);
    for (const s of Object.values(CIRCUIT_SYMBOLS)) {
      expect(FIGURE_PROMPT).toContain(s);
      // Each symbol is itself a drawing the checker accepts.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 200" class="qf" role="img"><g transform="translate(180 100)">${s}</g></svg>`;
      const problems = checkFigure(svg).problems.filter((p) => !p.includes("url(#qf-head)"));
      expect(problems).toEqual([]);
    }
  });

  test("JSON mode is asked for in the prompt, as DeepSeek requires", () => {
    expect(FIGURE_REQUEST.response_format).toEqual({ type: "json_object" });
    expect(FIGURE_PROMPT).toContain("Reply with one JSON object and nothing else");
    const [system, user] = figureMessages({
      subject: "physics",
      question: "Which arrow shows the activation energy?",
      brief: { kind: "energy-profile" },
    });
    expect(system).toEqual({ role: "system", content: FIGURE_PROMPT });
    expect(user.content).toContain('"question": "Which arrow shows the activation energy?"');
    expect(retryMessage(["A problem"]).content).toContain("- A problem");
  });
});
