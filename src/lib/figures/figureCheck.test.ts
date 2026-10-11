import { describe, expect, test } from "bun:test";
import { checkFigure, checkReply } from "./figureCheck";
import { FIGURE_EXAMPLES } from "./figurePrompt";

const [graph, circuit] = FIGURE_EXAMPLES;
const swap = (svg: string, from: string, to: string) => {
  expect(svg).toContain(from);
  return svg.replace(from, to);
};
const problemsOf = (svg: string, brief = graph.request.brief) => checkFigure(svg, brief).problems;

describe("the worked examples pass, so the prompt shows what passing looks like", () => {
  for (const e of FIGURE_EXAMPLES)
    test(e.name, () => {
      const r = checkReply(e.reply, e.request.brief);
      expect(r.problems).toEqual([]);
      expect(r.figure?.alt).toBe(e.reply.alt);
      expect(r.figure?.svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360');
    });
});

describe("a figure that is wrong is never shown", () => {
  test("a point away from where its values put it", () => {
    const svg = swap(graph.reply.svg, 'cx="232" cy="150.4"', 'cx="232" cy="140.4"');
    expect(problemsOf(svg)).toContain("The point (6, 20) is not where its values put it");
  });

  test("a line that bends where there is no point: smoothing, or a guess", () => {
    const svg = swap(graph.reply.svg, "176,150.4 232,150.4", "176,150.4 204,140 232,150.4");
    expect(problemsOf(svg).join()).toContain("A plotted line bends at (204, 140)");
  });

  test("a tick number away from its value: a stretched or mislabelled axis", () => {
    const svg = swap(
      graph.reply.svg,
      'x="176" y="242" text-anchor="middle">4<',
      'x="176" y="242" text-anchor="middle">5<',
    );
    expect(problemsOf(svg)).toContain('The x tick "5" is not at its value');
  });

  test("a colour, a style or a script of its own", () => {
    const svg = swap(
      graph.reply.svg,
      '<line class="qf-line" x1="64" y1="224"',
      '<line class="qf-line" fill="red" x1="64" y1="224"',
    );
    expect(problemsOf(svg).join()).toContain("has an attribute it may not carry: fill");
    const script = swap(graph.reply.svg, "</svg>", "<script>alert(1)</script></svg>");
    expect(problemsOf(script).join()).toContain("<script> is not allowed");
    // The page gets the parsed tree back, so the script never reaches it either way.
    expect(checkFigure(script).svg).not.toContain("script");
    const handler = swap(graph.reply.svg, 'role="img"', 'role="img" onload="alert(1)"');
    expect(checkFigure(handler).svg).not.toContain("onload");
  });

  test("text over text, and text over a line", () => {
    const over = swap(graph.reply.svg, 'x="204" y="266"', 'x="64" y="246"');
    expect(problemsOf(over).join()).toContain('Text "0" overlaps text "time in s"');
    const onLine = swap(
      graph.reply.svg,
      'x="16" y="22" text-anchor="start">distance',
      'x="60" y="120" text-anchor="start">distance',
    );
    expect(problemsOf(onLine)).toContain('Text "distance in m" sits on a line');
  });

  test("anything off the canvas, or a canvas of its own size", () => {
    const off = swap(graph.reply.svg, 'x="204" y="266"', 'x="204" y="276"');
    expect(problemsOf(off).join()).toContain("goes outside the canvas");
    const stretched = swap(graph.reply.svg, 'viewBox="0 0 360 280"', 'viewBox="0 0 360 290"');
    expect(problemsOf(stretched).join()).toContain("The viewBox is not");
  });

  test("a missing point, title or component", () => {
    const noPoint = swap(
      graph.reply.svg,
      '<circle class="qf-dot" cx="344" cy="40" r="3.5" data-x="10" data-y="50"/>',
      "",
    );
    expect(problemsOf(noPoint)).toContain("The point (10, 50) is missing or has no data-x/data-y");
    const noTitle = swap(graph.reply.svg, ">time in s<", ">time<");
    expect(problemsOf(noTitle)).toContain('The x-axis title "time in s" is missing');
    const noLamp = circuit.reply.svg.replace(
      /<g transform="translate\(300 115\) rotate\(90\)">.*?<\/g><\/g>/,
      "",
    );
    expect(problemsOf(noLamp, circuit.request.brief)).toContain(
      "The circuit has 0 lamp symbol(s); the brief has 1",
    );
  });

  test("labels that don't list the figure's text", () => {
    const reply = { ...graph.reply, labels: graph.reply.labels.slice(1) };
    expect(checkReply(reply, graph.request.brief).problems).toContain(
      "labels must list every line of text in the svg, exactly as written",
    );
  });

  test("a reply that draws nothing says why, and carries no svg", () => {
    const key = { kind: "dichotomous-key", statements: ["1a Has legs - go to 2"] };
    const none = {
      status: "not_needed",
      reason: "A key is laid out as text.",
      alt: "",
      labels: [],
      svg: "",
    };
    expect(checkReply(none, key)).toEqual({ problems: [], status: "not_needed", figure: null });
    expect(checkReply({ ...none, reason: "" }, key).problems).toContain(
      'A reply with status "not_needed" says why in reason',
    );
    expect(checkReply({ ...none, svg: graph.reply.svg }, key).problems).toContain(
      'A reply with status "not_needed" has no svg',
    );
    expect(checkReply("not json", key).problems).toEqual(["The reply is not a JSON object"]);
  });
});
