/**
 * A figure brief as the question writer gives it: the output schema it fills
 * in, the instructions it follows, and the check every brief passes before
 * anything is drawn. A brief that passes here fits its canvas: axis numbers
 * stay on it, names wrap within their room, and every value sits on its axis.
 */
import { CIRCUIT_SYMBOLS, TEXT_SIZE, textWidth, type Axis, type KnownBrief } from "./figure";
import { PROFILE_NAME_WIDTH, ticks, wrap } from "./figureDraw";

/** Questions in one set that may carry a figure. */
export const MAX_FIGURES = 2;

const COMPONENT_TYPES = [
  ...Object.keys(CIRCUIT_SYMBOLS).filter((s) => s !== "meter"),
  "ammeter",
  "voltmeter",
  "motor",
];
const ARROWS = [
  "activation energy",
  "activation energy with a catalyst",
  "overall energy change",
] as const;

const str = { type: "string" };
const strict = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const axis = strict({
  title: str,
  min: { type: "number" },
  max: { type: "number" },
  step: { type: "number" },
});

/**
 * The `figure` field of a question in the writer's output: null, or one
 * brief. Structured outputs take no recursive schemas, so a circuit's
 * parallel branches hold components only, one level deep: GCSE circuits
 * need no more.
 */
export const FIGURE_BRIEF_SCHEMA = {
  anyOf: [
    { type: "null" },
    strict({
      kind: { type: "string", enum: ["line-graph", "scatter"] },
      x: axis,
      y: axis,
      series: {
        type: "array",
        items: strict({
          name: str,
          points: { type: "array", items: { type: "array", items: { type: "number" } } },
        }),
      },
    }),
    strict({
      kind: { type: "string", enum: ["bar-chart"] },
      x: strict({ title: str, categories: { type: "array", items: str } }),
      y: axis,
      series: {
        type: "array",
        items: strict({ name: str, values: { type: "array", items: { type: "number" } } }),
      },
    }),
    strict({
      kind: { type: "string", enum: ["circuit"] },
      components: {
        type: "array",
        items: strict({
          type: { type: "string", enum: COMPONENT_TYPES },
          label: { anyOf: [str, { type: "null" }] },
        }),
      },
      loop: {
        type: "array",
        items: {
          anyOf: [
            { type: "integer" },
            strict({
              parallel: { type: "array", items: { type: "array", items: { type: "integer" } } },
            }),
          ],
        },
      },
      layout: str,
    }),
    strict({
      kind: { type: "string", enum: ["energy-profile"] },
      reaction: { type: "string", enum: ["exothermic", "endothermic"] },
      catalyst: { type: "boolean" },
      reactants: str,
      products: str,
      arrows: {
        type: "array",
        items: strict({ shows: { type: "string", enum: [...ARROWS] }, letter: str }),
      },
    }),
    strict({
      kind: { type: "string", enum: ["food-web"] },
      organisms: { type: "array", items: strict({ name: str, level: { type: "integer" } }) },
      eaten: { type: "array", items: { type: "array", items: str } },
    }),
  ],
};

/** What the writer is told about figures, when a set may have them. */
export const FIGURE_GUIDE = `FIGURES
At most ${MAX_FIGURES} questions in the set may each come with one figure, where a figure is how an exam paper would give the information: a graph or bar chart of results to read or interpret, a circuit, a reaction profile or a food web. Most questions have none: their figure is null. Never add a figure for decoration, and never ask a student to draw, plot, sketch or label one.
A figure given as a brief is not absent: the website draws it from the brief and shows it below the question's text. The question says what the figure shows ("The graph shows how the velocity of a car changed.") and is answered from it, so it doesn't repeat the figure's data. Nothing in the figure may give the answer away: no title or label names what the question asks for.
The brief holds every value, label and connection; the figure shows exactly the brief:
- "line-graph" or "scatter": x and y axes, each {title: quantity and unit as "time in s", min, max, step}, 2 to 12 steps, max − min a whole number of steps, and numbers short enough to fit (at most 3 digits on the x axis). series: one ("scatter": exactly one) or two {name, points: [[x, y], …]}, 2 to 20 points, each within both axes. A line graph joins its points in order with straight lines.
- "bar-chart": x {title, categories: 2 to 6 short names}, y an axis as above, series: one or two {name, values: one per category, each within the y axis}.
- "circuit": components, each {type, label: null unless the question names the part, e.g. "X"}; loop: going once round the main loop, each step is a component's index in components (counting from 0), or {"parallel": [[index, …], [index, …]]} for branches side by side between the same two junctions; every component appears exactly once. layout: in words, which wire each part sits on ("the cell on the top wire, the ammeter on the left wire, the two lamps in parallel on the right").
- "energy-profile": reaction "exothermic" or "endothermic", catalyst true or false, reactants and products as they are written under the levels (short: "CH₄ + 2O₂", "CO₂ + 2H₂O"), arrows: only those the question needs, each {shows: "activation energy", "activation energy with a catalyst" (only with a catalyst) or "overall energy change", letter: one capital letter}.
- "food-web": organisms {name, level: 1 for producers, 2 for what eats them, and so on}, at most 4 on a level and 12 in all; eaten: [food, eater] pairs, one per arrow, using the organisms' names exactly.
Titles and names: plain words and proper notation (cm³, CO₂, °C), at most 28 characters.`;

const SMALL = TEXT_SIZE["qf-small"]!;
const TEXT = TEXT_SIZE["qf-text"]!;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown, max = 28): v is string =>
  typeof v === "string" && v.trim().length > 0 && [...v.trim()].length <= max;
const within = (v: number, a: Axis) => v >= a.min - 1e-9 && v <= a.max + 1e-9;

/** Why an axis won't draw, or null. `x`: its numbers run along the bottom, the last one near the edge. */
function axisProblem(a: unknown, name: string, x: boolean): string | null {
  const ax = a as Axis | null;
  if (!ax || !isText(ax.title)) return `${name} axis needs a title of at most 28 characters`;
  if (![ax.min, ax.max, ax.step].every(isNum) || ax.max <= ax.min || ax.step <= 0)
    return `${name} axis needs min < max and a positive step`;
  const steps = (ax.max - ax.min) / ax.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-6 || Math.round(steps) < 2 || Math.round(steps) > 12)
    return `${name} axis must run from min to max in 2 to 12 whole steps`;
  const widest = Math.max(...ticks(ax).map((v) => textWidth(String(Number(v.toFixed(2))), SMALL)));
  if (widest > (x ? 28 : 46)) return `${name} axis numbers are too long to fit`;
  return null;
}

/**
 * The brief checked, with its text trimmed and a circuit's null labels
 * dropped; or what is wrong with it, in words the writer's log can show.
 */
export function readBrief(value: unknown): { brief: KnownBrief } | { problem: string } {
  const b = value as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return { problem: "is not a brief" };
  switch (b.kind) {
    case "line-graph":
    case "scatter": {
      const problem = axisProblem(b.x, "x", true) ?? axisProblem(b.y, "y", false);
      if (problem) return { problem };
      const series = b.series as { name: unknown; points: unknown }[];
      const most = b.kind === "scatter" ? 1 : 2;
      if (!Array.isArray(series) || series.length < 1 || series.length > most)
        return {
          problem: `needs ${b.kind === "scatter" ? "exactly one series" : "one or two series"}`,
        };
      for (const s of series) {
        if (!isText(s?.name, 20))
          return { problem: "needs a name of at most 20 characters for each series" };
        const pts = s.points as unknown[];
        if (!Array.isArray(pts) || pts.length < 2 || pts.length > 20)
          return { problem: "needs 2 to 20 points in each series" };
        for (const p of pts)
          if (
            !Array.isArray(p) ||
            p.length !== 2 ||
            !p.every(isNum) ||
            !within(p[0], b.x as Axis) ||
            !within(p[1], b.y as Axis)
          )
            return { problem: "has a point that is not [x, y] within both axes" };
      }
      return { brief: b as unknown as KnownBrief };
    }
    case "bar-chart": {
      const x = b.x as { title: unknown; categories: unknown } | null;
      if (!x || !isText(x.title))
        return { problem: "x axis needs a title of at most 28 characters" };
      const cats = x.categories as unknown[];
      if (
        !Array.isArray(cats) ||
        cats.length < 2 ||
        cats.length > 6 ||
        !cats.every((c) => isText(c, 14))
      )
        return { problem: "needs 2 to 6 category names" };
      const slot = 280 / cats.length;
      if (cats.some((c) => textWidth((c as string).trim(), SMALL) > slot - 6))
        return { problem: "has a category name too long for its bar" };
      const problem = axisProblem(b.y, "y", false);
      if (problem) return { problem };
      const series = b.series as { name: unknown; values: unknown }[];
      if (!Array.isArray(series) || series.length < 1 || series.length > 2)
        return { problem: "needs one or two series" };
      for (const s of series) {
        if (!isText(s?.name, 20))
          return { problem: "needs a name of at most 20 characters for each series" };
        const values = s.values as unknown[];
        if (
          !Array.isArray(values) ||
          values.length !== cats.length ||
          !values.every((v) => isNum(v) && within(v, b.y as Axis))
        )
          return { problem: "needs one value per category, each within the y axis" };
      }
      return { brief: b as unknown as KnownBrief };
    }
    case "energy-profile": {
      if (b.reaction !== "exothermic" && b.reaction !== "endothermic")
        return { problem: "reaction must be exothermic or endothermic" };
      if (typeof b.catalyst !== "boolean") return { problem: "catalyst must be true or false" };
      const reactants = isText(b.reactants)
        ? wrap(b.reactants as string, PROFILE_NAME_WIDTH.reactants, TEXT)
        : null;
      const products = isText(b.products)
        ? wrap(b.products as string, PROFILE_NAME_WIDTH.products, TEXT)
        : null;
      if (!reactants || reactants.length > 2 || !products || products.length > 2)
        return { problem: "has a reactants or products name too long to fit under its level" };
      const arrows = b.arrows as { shows: unknown; letter: unknown }[];
      if (!Array.isArray(arrows) || arrows.length < 1 || arrows.length > 3)
        return { problem: "needs 1 to 3 arrows" };
      if (
        arrows.some(
          (a) => !ARROWS.includes(a?.shows as (typeof ARROWS)[number]) || !isText(a.letter, 2),
        )
      )
        return { problem: "has an arrow that is not one a reaction profile has, or has no letter" };
      if (
        new Set(arrows.map((a) => a.shows)).size !== arrows.length ||
        new Set(arrows.map((a) => a.letter)).size !== arrows.length
      )
        return { problem: "has two arrows showing the same thing, or sharing a letter" };
      if (!b.catalyst && arrows.some((a) => a.shows === "activation energy with a catalyst"))
        return { problem: "has a catalysed arrow but no catalyst" };
      return { brief: b as unknown as KnownBrief };
    }
    case "circuit": {
      const components = b.components as { type: unknown; label?: unknown }[];
      if (!Array.isArray(components) || components.length < 2 || components.length > 8)
        return { problem: "needs 2 to 8 components" };
      if (components.some((c) => !COMPONENT_TYPES.includes(c?.type as string)))
        return { problem: "has a component the circuit symbols don't include" };
      const labels = components.map((c) => c.label).filter((l) => l !== null && l !== undefined);
      if (labels.some((l) => !isText(l, 6)) || new Set(labels).size !== labels.length)
        return { problem: "has a label that is empty, longer than 6 characters, or used twice" };
      const loop = b.loop as unknown[];
      const used: number[] = [];
      const index = (s: unknown) =>
        Number.isInteger(s) && (s as number) >= 0 && (s as number) < components.length;
      const fine =
        Array.isArray(loop) &&
        loop.length >= 2 &&
        loop.every((s) => {
          if (index(s)) return used.push(s as number) > 0;
          const branches = (s as { parallel?: unknown })?.parallel;
          return (
            Array.isArray(branches) &&
            branches.length >= 2 &&
            branches.every(
              (br) =>
                Array.isArray(br) && br.length > 0 && br.every((i) => index(i) && used.push(i) > 0),
            )
          );
        });
      if (!fine || used.length !== components.length || new Set(used).size !== used.length)
        return { problem: "loop must name every component exactly once, in at least two steps" };
      if (!isText(b.layout, 400)) return { problem: "needs a layout in words" };
      return {
        brief: {
          kind: "circuit",
          components: components.map((c) => ({
            type: c.type as never,
            ...(isText(c.label, 6) ? { label: (c.label as string).trim() } : {}),
          })),
          loop: loop as never,
          layout: (b.layout as string).trim(),
        },
      };
    }
    case "food-web": {
      const organisms = b.organisms as { name: unknown; level: unknown }[];
      if (!Array.isArray(organisms) || organisms.length < 2 || organisms.length > 12)
        return { problem: "needs 2 to 12 organisms" };
      if (
        organisms.some(
          (o) =>
            !isText(o?.name, 20) ||
            !Number.isInteger(o.level) ||
            (o.level as number) < 1 ||
            (o.level as number) > 4,
        )
      )
        return { problem: "has an organism without a name or a level from 1 to 4" };
      const names = organisms.map((o) => (o.name as string).trim());
      if (new Set(names).size !== names.length) return { problem: "names an organism twice" };
      for (let level = 1; level <= 4; level++)
        if (organisms.filter((o) => o.level === level).length > 4)
          return { problem: "has more than 4 organisms on a level" };
      const eaten = b.eaten as unknown[];
      if (!Array.isArray(eaten) || eaten.length < 1 || eaten.length > 16)
        return { problem: "needs 1 to 16 [food, eater] pairs" };
      const pairs = new Set<string>();
      for (const p of eaten) {
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          !p.every((n) => names.includes(String(n).trim())) ||
          p[0] === p[1]
        )
          return { problem: "has a [food, eater] pair that doesn't name two of its organisms" };
        pairs.add(`${p[0]}→${p[1]}`);
      }
      if (pairs.size !== eaten.length) return { problem: "has the same arrow twice" };
      return { brief: b as unknown as KnownBrief };
    }
    default:
      return { problem: `kind "${String(b.kind)}" is not one the website draws` };
  }
}
