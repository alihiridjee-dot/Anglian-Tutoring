/**
 * A figure brief as the question writer gives it: the output schema it fills
 * in, the instructions it follows, and the check every brief passes before
 * anything is drawn. A brief that passes here fits its canvas: axis numbers
 * stay on it, names wrap within their room, and every value sits on its axis.
 */
import {
  CHROMATOGRAM,
  CIRCUIT_SYMBOLS,
  FORCES,
  FORCE_DIRECTIONS,
  TEXT_SIZE,
  WAVE_SPANS,
  plotX,
  plotY,
  textWidth,
  type Axis,
  type KnownBrief,
} from "./figure";
import { checkFigure } from "./figureCheck";
import { PROFILE_NAME_WIDTH, drawWithCode, forceLabel, ticks, wrap } from "./figureDraw";
import { GRAPH_HEIGHT } from "./figureSvg";
import { KINDS, figureKind } from "./kinds";

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

/**
 * The `figure` field of a question in the writer's output: the brief as JSON
 * written out as text, or "" for none. Structured outputs refuse a schema
 * with every kind of brief spelled out for every question ("the compiled
 * grammar is too large", found on the first real call, 17 Oct), so the text
 * is read here instead, by `readBrief`.
 */
export const FIGURE_FIELD = {
  type: "string",
  description: 'The figure brief as one JSON object, or "" for a question without a figure.',
};

/** What the writer is told about figures, when a set may have them. */
export const FIGURE_GUIDE = `FIGURES
At most ${MAX_FIGURES} questions in the set may each come with one figure, where a figure is how an exam paper would give the information: a graph or bar chart of results to read or interpret, a circuit, a reaction profile, a food web, a chromatogram, a wave, the forces acting on an object${KINDS.map((k) => `, ${k.name}`).join("")}. Most questions have none: their figure is "". A question with one writes its brief in figure as one JSON object, with "kind" and the fields below. Never add a figure for decoration, and never ask a student to draw, plot, sketch or label one.
A figure given as a brief is not absent: the website draws it from the brief and shows it below the question's text. The question says what the figure shows ("The graph shows how the velocity of a car changed.") and is answered from it, so it doesn't repeat the figure's data. Nothing in the figure may give the answer away: no title or label names what the question asks for.
The brief holds every value, label and connection; the figure shows exactly the brief:
- "line-graph" or "scatter": x and y axes, each {title: quantity and unit as "time in s", min, max, step}, 2 to 12 steps, max − min a whole number of steps, and numbers short enough to fit (at most 3 digits on the x axis). series: one ("scatter": exactly one) or two {name, points: [[x, y], …]}, 2 to 20 points, each within both axes. A line graph joins its points in order with straight lines; with "curve": true it joins them with a smooth curve instead (each series' x values increasing), for results that change smoothly, and the curve never rises or falls beyond its points. lines: up to 2 straight lines drawn on the graph, each {from: [x, y], to: [x, y]} within both axes, for a line of best fit or a tangent the question uses; leave it out when there is none.
- "bar-chart": x {title, categories: 2 to 6 names, each short enough to fit under its bar: at most 15 characters with 2 bars, 10 with 3, 7 with 4, 5 with 5 and 4 with 6}, y an axis as above starting at 0, series: one or two {name, values: one per category, each within the y axis}.
- "circuit": components, each {type: one of ${COMPONENT_TYPES.join(", ")}; label: null unless the question names the part, e.g. "X"}; loop: going once round the main loop, each step is a component's index in components (counting from 0), or {"parallel": [[index, …], [index, …]]} for branches side by side between the same two junctions; every component appears exactly once. layout: in words, which wire each part sits on ("the cell on the top wire, the ammeter on the left wire, the two lamps in parallel on the right").
- "energy-profile": reaction "exothermic" or "endothermic", catalyst true or false, reactants and products as they are written under the levels (short: "CH₄ + 2O₂", "CO₂ + 2H₂O"), arrows: only those the question needs, each {shows: "activation energy", "activation energy with a catalyst" (only with a catalyst) or "overall energy change", letter: one capital letter}.
- "food-web": organisms {name, level: 1 for producers, 2 for what eats them, and so on}, at most 4 on a level and 12 in all; eaten: [food, eater] pairs, one per arrow, using the organisms' names exactly, each eater on a higher level than its food.
- "chromatogram": y: the scale up the paper's side, an axis as above starting at 0 at the start line ({title: "distance in cm", min: 0, max, step}); front: the solvent front's distance from the start line, from half of y.max to y.max; samples: 2 to 6 lanes in order across the paper, each {name, spots: 1 to 5 distances from the start line, each from 0 (a spot that stayed on the start line) to below the front, at least y.max ÷ 16 apart}. Names short enough to fit under their lane: at most 11 characters with 2 lanes, 7 with 3, 5 with 4, 4 with 5 and 3 with 6. The website labels the start line and the solvent front.
- "wave": one of two kinds. Lettered: arrows: 1 to 4 {shows: "amplitude", "wavelength", "crest to trough" or "half a wavelength", letter: one capital letter}, each shows once, and no axes; the website draws two whole waves the same size every time. On a scale: x and y axes as for a line graph, x along the wave ("distance in cm", or "time in ms" for an oscilloscope trace), y the displacement from −y.max to y.max; amplitude (from a quarter of y.max to y.max) and wavelength (the length of one whole wave along x, its period when x is time), with x.max − x.min holding 1 to 6 whole waves; no arrows. The wave starts at 0 and rises first.
- "forces": object: its name, at most 8 characters, written in a box ("van", "crate"), or ""; forces: 1 to 4, each {direction: "up", "down", "left" or "right", each direction once; name: what the force is ("weight", "air resistance") or the letter the question asks about ("X"); size: in newtons, or null for the one the question asks the student to find}; toScale: true only when every size is given, the smallest at least a quarter of the largest: the arrows' lengths are then in proportion; otherwise every arrow is the same length.
${KINDS.map((k) => `- "${k.kind}": ${k.guide}\n`).join("")}Scale each axis so the values the question turns on are easy to read off: put them on grid lines, and don't share one graph between two series of very different sizes (hundreds of rabbits, tens of foxes).
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
      if (b.curve !== undefined && typeof b.curve !== "boolean")
        return { problem: "curve must be true or false" };
      if (b.curve && b.kind !== "line-graph") return { problem: "only a line graph has a curve" };
      // A curve is drawn left to right through its points.
      if (
        b.curve &&
        series.some((s) =>
          (s.points as [number, number][]).some((p, i, ps) => i > 0 && p[0] <= ps[i - 1][0]),
        )
      )
        return { problem: "has a curve whose points' x values don't increase" };
      if (b.lines !== undefined) {
        const lines = b.lines as { from: unknown; to: unknown }[];
        if (!Array.isArray(lines) || lines.length > 2)
          return { problem: "has more than 2 straight lines" };
        const [x, y] = [b.x as Axis, b.y as Axis];
        const end = (p: unknown): p is [number, number] =>
          Array.isArray(p) &&
          p.length === 2 &&
          p.every(isNum) &&
          within(p[0], x) &&
          within(p[1], y);
        for (const l of lines) {
          if (!end(l?.from) || !end(l.to))
            return { problem: "has a straight line whose ends are not [x, y] within both axes" };
          const length = Math.hypot(
            plotX(l.to[0], x) - plotX(l.from[0], x),
            plotY(l.to[1], y, GRAPH_HEIGHT) - plotY(l.from[1], y, GRAPH_HEIGHT),
          );
          if (length < 24) return { problem: "has a straight line too short to see" };
        }
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
      // A bar stands on zero: from any other axis start, its height misstates its value.
      if ((b.y as Axis).min !== 0)
        return { problem: "y axis must start at 0, where the bars stand" };
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
      const level = new Map(organisms.map((o) => [(o.name as string).trim(), o.level as number]));
      const pairs = new Set<string>();
      for (const p of eaten) {
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          !p.every((n) => names.includes(String(n).trim())) ||
          p[0] === p[1]
        )
          return { problem: "has a [food, eater] pair that doesn't name two of its organisms" };
        // Food is eaten by something on a higher level: a pair the other way round
        // would have its arrow drawn, and checked, pointing the wrong way.
        if (level.get(String(p[0]).trim())! >= level.get(String(p[1]).trim())!)
          return { problem: `has ${p[0]} eaten by ${p[1]}, which is not on a higher level` };
        pairs.add(`${p[0]}→${p[1]}`);
      }
      if (pairs.size !== eaten.length) return { problem: "has the same arrow twice" };
      return { brief: b as unknown as KnownBrief };
    }
    case "chromatogram": {
      const problem = axisProblem(b.y, "y", false);
      if (problem) return { problem };
      const y = b.y as Axis;
      // The start line is the scale's 0: a distance is measured from it.
      if (y.min !== 0) return { problem: "y axis must start at 0, at the start line" };
      const front = b.front;
      if (!isNum(front) || front < y.max / 2 || front > y.max)
        return { problem: "front must be from half of y.max to y.max" };
      const samples = b.samples as { name: unknown; spots: unknown }[];
      if (!Array.isArray(samples) || samples.length < 2 || samples.length > 6)
        return { problem: "needs 2 to 6 samples" };
      const slot = (CHROMATOGRAM.right - CHROMATOGRAM.left) / samples.length;
      for (const s of samples) {
        if (!isText(s?.name, 12)) return { problem: "needs a short name for each sample" };
        if (textWidth((s.name as string).trim(), SMALL) > slot - 6)
          return { problem: "has a sample name too long for its lane" };
        const spots = s.spots as unknown[];
        if (!Array.isArray(spots) || spots.length < 1 || spots.length > 5)
          return { problem: "needs 1 to 5 spots in each sample" };
        if (!spots.every((v) => isNum(v) && v >= 0 && v < front))
          return { problem: "has a spot that is not from 0 to below the solvent front" };
        const sorted = [...(spots as number[])].sort((p, q) => p - q);
        // Closer, two spots in a lane would be drawn as one.
        if (sorted.some((v, i) => i > 0 && v - sorted[i - 1] < y.max / 16 - 1e-9))
          return { problem: "has two spots in one lane closer than y.max ÷ 16" };
      }
      const names = samples.map((s) => (s.name as string).trim());
      if (new Set(names).size !== names.length) return { problem: "names a sample twice" };
      return {
        brief: {
          kind: "chromatogram",
          y,
          front,
          samples: samples.map((s, i) => ({ name: names[i], spots: s.spots as number[] })),
        },
      };
    }
    case "wave": {
      const scaled = "x" in b || "y" in b;
      if (scaled) {
        if (Array.isArray(b.arrows) && b.arrows.length)
          return { problem: "has both axes and arrows: a wave has one or the other" };
        const problem = axisProblem(b.x, "x", true) ?? axisProblem(b.y, "y", false);
        if (problem) return { problem };
        const [x, y] = [b.x as Axis, b.y as Axis];
        if (Math.abs(y.min + y.max) > 1e-9)
          return { problem: "y axis must run from −y.max to y.max, with the wave's middle at 0" };
        const { amplitude, wavelength } = b;
        // Lower than a quarter of the axis, a wave is drawn nearly flat.
        if (!isNum(amplitude) || amplitude < y.max / 4 || amplitude > y.max + 1e-9)
          return { problem: "amplitude must be from a quarter of y.max to y.max" };
        if (!isNum(wavelength) || wavelength <= 0) return { problem: "needs a wavelength above 0" };
        const waves = (x.max - x.min) / wavelength;
        if (waves < 1 - 1e-9 || waves > 6 + 1e-9)
          return { problem: "x axis must hold 1 to 6 whole waves" };
        return {
          brief: {
            kind: "wave",
            x: { ...x, title: x.title.trim() },
            y: { ...y, title: y.title.trim() },
            amplitude,
            wavelength,
          },
        };
      }
      const arrows = b.arrows as { shows: unknown; letter: unknown }[];
      if (!Array.isArray(arrows) || arrows.length < 1 || arrows.length > 4)
        return { problem: "needs 1 to 4 arrows, or axes" };
      if (
        arrows.some(
          (a) =>
            !WAVE_SPANS.includes(a?.shows as (typeof WAVE_SPANS)[number]) || !isText(a.letter, 2),
        )
      )
        return { problem: "has an arrow that is not one a wave diagram has, or has no letter" };
      if (
        new Set(arrows.map((a) => a.shows)).size !== arrows.length ||
        new Set(arrows.map((a) => (a.letter as string).trim())).size !== arrows.length
      )
        return { problem: "has two arrows showing the same thing, or sharing a letter" };
      return {
        brief: {
          kind: "wave",
          arrows: arrows.map((a) => ({
            shows: a.shows as (typeof WAVE_SPANS)[number],
            letter: (a.letter as string).trim(),
          })),
        },
      };
    }
    case "forces": {
      const object = typeof b.object === "string" ? b.object.trim() : null;
      if (object === null) return { problem: 'needs an object name, or ""' };
      if (textWidth(object, TEXT) > FORCES.box.x1 - FORCES.box.x0 - 8)
        return { problem: "has an object name too long for its box" };
      const forces = b.forces as { direction: unknown; name: unknown; size: unknown }[];
      if (!Array.isArray(forces) || forces.length < 1 || forces.length > 4)
        return { problem: "needs 1 to 4 forces" };
      const read: {
        direction: (typeof FORCE_DIRECTIONS)[number];
        name: string;
        size: number | null;
      }[] = [];
      for (const f of forces) {
        if (!FORCE_DIRECTIONS.includes(f?.direction as (typeof FORCE_DIRECTIONS)[number]))
          return { problem: 'has a force whose direction is not "up", "down", "left" or "right"' };
        if (!isText(f.name))
          return { problem: "needs a name of at most 28 characters for each force" };
        if (f.size !== null && (!isNum(f.size) || f.size <= 0))
          return { problem: "has a size that is not a number above 0, or null" };
        const force = {
          direction: f.direction as (typeof FORCE_DIRECTIONS)[number],
          name: (f.name as string).trim(),
          size: f.size as number | null,
        };
        const lines = forceLabel(force);
        if (!lines || lines.length > 3 || lines.some((l) => textWidth(l, TEXT) > FORCES.nameWidth))
          return { problem: "has a force name too long for its label" };
        read.push(force);
      }
      if (new Set(read.map((f) => f.direction)).size !== read.length)
        return { problem: "has two forces the same way" };
      if (new Set(read.map((f) => f.name)).size !== read.length)
        return { problem: "names a force twice" };
      if (typeof b.toScale !== "boolean") return { problem: "toScale must be true or false" };
      if (b.toScale) {
        const sizes = read.map((f) => f.size);
        if (sizes.some((s) => s === null))
          return { problem: "is drawn to scale, so every force needs its size" };
        // Any shorter, an arrow is mostly its head.
        if (Math.min(...(sizes as number[])) < Math.max(...(sizes as number[])) / 4)
          return {
            problem:
              "is drawn to scale, so the smallest force must be at least a quarter of the largest",
          };
      }
      return { brief: { kind: "forces", object, forces: read, toScale: b.toScale } };
    }
    default: {
      const kind = figureKind(b.kind);
      if (!kind) return { problem: `kind "${String(b.kind)}" is not one the website draws` };
      // A kind whose room depends on more than its own fields tries its drawing.
      const fits = (brief: unknown) => {
        const drawn = drawWithCode(brief as KnownBrief);
        return drawn
          ? checkFigure(drawn.svg, brief as KnownBrief).problems
          : ["doesn't fit its canvas"];
      };
      return kind.read(b, fits) as { brief: KnownBrief } | { problem: string };
    }
  }
}
