/**
 * The revision-note format.
 *
 * One note per *concept* (see scripts/notes/concepts), shared by every board
 * that teaches it, plus a thin per-board layer holding the parts that come
 * from that board's own papers: its spec codes, the mark-scheme phrases that
 * score, the usual mistakes and a worked past-paper question.
 *
 * The shape is deliberately small. A note is prose, lists, numbered steps,
 * tables and a handful of diagram kinds — enough to explain GCSE science
 * clearly, and few enough that every note looks like every other note.
 *
 * Inline text supports **bold** and nothing else.
 */

import { evaluate, parseFormula, variablesOf } from "./formula";

export const NOTE_FORMAT_VERSION = 1;

export const NOTE_BOARDS = ["aqa", "edexcel", "ocr"] as const;
export type NoteBoard = (typeof NOTE_BOARDS)[number];

export type NoteBlock =
  | { type: "paragraph"; text: string }
  | { type: "subheading"; text: string }
  | { type: "list"; items: string[] }
  /** Key words, each with a one-line meaning. Shown as a panel, not buried in prose. */
  | { type: "definitions"; items: { term: string; meaning: string }[] }
  /** An equation in its own box. `where` lists each symbol or word with its unit. */
  | { type: "equation"; label?: string; formula: string; where?: string[] }
  /** The two to four things to take away from a section. */
  | { type: "key-points"; items: string[] }
  | { type: "steps"; items: { lead: string; text: string }[] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "diagram"; diagram: NoteDiagram };

/** A line graph of one or more series over a shared x axis. Shape, not data: y is 0–1. */
export interface LineGraphDiagram {
  kind: "line-graph";
  alt: string;
  x: { label: string; min: number; max: number; ticks: number[]; unit?: string };
  /** `zero` (0–1) draws a labelled zero line, for quantities that go negative, e.g. change in mass. */
  y: { label: string; zero?: number };
  series: { name: string; points: [number, number][] }[];
  markers?: { x: number; label: string }[];
  bands?: { from: number; to: number; label: string }[];
}

/** Boxes joined by arrows; `loop` draws the arrow back from the last box to the first. */
export interface FlowDiagram {
  kind: "flow";
  alt: string;
  steps: string[];
  loop?: boolean;
}

/** Two or more things side by side, compared feature by feature. */
export interface CompareDiagram {
  kind: "compare";
  alt: string;
  items: string[];
  rows: { feature: string; values: string[] }[];
}

/**
 * Pick one option and see what happens, e.g. a salt solution and its
 * electrolysis products, or two parents and their offspring.
 */
export interface PredictorDiagram {
  kind: "predictor";
  alt: string;
  /** "Pick a salt solution" */
  prompt: string;
  /** The rows every result has, e.g. ["Negative electrode", "Positive electrode", "What you see"]. */
  result_labels: string[];
  options: { label: string; results: string[]; explanation?: string; scene?: PredictorScene }[];
}

/**
 * An illustrated scene drawn above a predictor's result. If one option has a
 * scene, every option must. Scenes are drawn by the app; a note only fills them in.
 */
export type PredictorScene = ElectrolysisScene | TubesScene | FlameScene | EnergyProfileScene;

/** Colours a tube, flame or indicator can be. The app owns the exact shades. */
export const SCENE_COLOURS = [
  "colourless",
  "white",
  "cream",
  "pale-yellow",
  "yellow",
  "orange",
  "orange-red",
  "brick-red",
  "red",
  "crimson",
  "pink",
  "purple",
  "lilac",
  "blue",
  "pale-blue",
  "blue-black",
  "green",
  "pale-green",
  "green-blue",
  "brown",
  "black",
  "grey",
] as const;
export type SceneColour = (typeof SCENE_COLOURS)[number];

/** Test tubes side by side: food tests, indicators, precipitate tests for ions. */
export interface TubesScene {
  kind: "tubes";
  tubes: { label: string; colour: SceneColour; precipitate?: SceneColour; bubbles?: boolean }[];
}

/** A Bunsen flame in a colour: flame tests for metal ions. */
export interface FlameScene {
  kind: "flame";
  colour: SceneColour;
}

/** A reaction profile: energy of reactants and products, activation energy, optional catalyst path. */
export interface EnergyProfileScene {
  kind: "energy-profile";
  direction: "exothermic" | "endothermic";
  catalyst?: boolean;
}

/** An electrolysis cell with inert electrodes. */
export interface ElectrolysisScene {
  kind: "electrolysis";
  /** The salt's two ions, positive first, e.g. ["Cu²⁺", "SO₄²⁻"]. H⁺ and OH⁻ from water are added. */
  ions: [string, string];
  negative: { product: string; form: "gas" | "metal"; metal?: "copper" | "silver" | "grey" };
  positive: { product: string; form: "gas" | "solution"; colour?: "orange" | "brown" | "green" };
  /** Leave out H⁺ and OH⁻ for a molten compound. */
  molten?: boolean;
}

/** An illustrated scene drawn by a slider. Each names the inputs or outputs it shows. */
export type SliderScene =
  /** A car on a road: thinking and braking distance (output indexes) as bands. */
  | { kind: "road"; thinking: number; braking: number }
  /** A moving transverse wave: amplitude and frequency are input ids. */
  | { kind: "wave"; amplitude: string; frequency: string }
  /** Particles in a box that change state as `temperature` (an input id) crosses the melting and boiling points. */
  | { kind: "particles"; temperature: string; melting: number; boiling: number }
  /** 100 nuclei; at `time` (input id) a fraction 1 − ½^(time/half_life) has decayed. Same units for both. */
  | { kind: "half-life"; time: string; half_life: number }
  /** A flask fizzing into a gas syringe; `volume` (output index) of `max` cm³ collected, `rate` (output index, optional) sets the fizz. */
  | { kind: "gas-syringe"; volume: number; max: number; rate?: number }
  /** Two bulbs in series or parallel, glowing with `brightness` (output index) out of `max`. */
  | { kind: "circuit"; arrangement: "series" | "parallel"; brightness: number; max: number }
  /** An enzyme and substrate; the active site distorts as `condition` (input id) moves from `optimum`, and denatures beyond `denatures_at` away. */
  | { kind: "enzyme"; condition: string; optimum: number; denatures_at: number }
  /** Two regions separated by a membrane; `left` and `right` (input ids) set the concentrations. */
  | { kind: "diffusion"; left: string; right: string; membrane?: string }
  /** The universal indicator scale with a marker at `ph` (input id, 0–14). */
  | { kind: "ph"; ph: string };

/** A number input: a slider between min and max, or a set of named choices. */
export type SliderInput =
  | {
      id: string;
      label: string;
      unit?: string;
      min: number;
      max: number;
      step: number;
      value: number;
    }
  | { id: string; label: string; choices: { label: string; value: number }[] };

/**
 * Move a slider and watch the numbers change, e.g. speed against stopping
 * distance. Formulas use the inputs' ids and + - * / ^ ( ) sqrt abs min max.
 * Outputs marked `bar` are drawn as one stacked bar, in order.
 */
export interface SliderDiagram {
  kind: "slider";
  alt: string;
  inputs: SliderInput[];
  outputs: { label: string; unit?: string; formula: string; decimals?: number; bar?: boolean }[];
  scene?: SliderScene;
}

/** Put jumbled steps into the right order. `steps` is the correct order. */
export interface SequenceDiagram {
  kind: "sequence";
  alt: string;
  prompt: string;
  steps: string[];
}

/** Sort statements into two or three groups. `group` is an index into `groups`. */
export interface SortDiagram {
  kind: "sort";
  alt: string;
  prompt: string;
  groups: string[];
  items: { text: string; group: number }[];
}

/**
 * A single-gene cross. Genotypes are two letters, each either the dominant or
 * the recessive allele; a genotype with the dominant allele shows the dominant
 * phenotype. Sex determination fits too: dominant "Y" → "Male", recessive "X" → "Female".
 */
export interface PunnettDiagram {
  kind: "punnett";
  alt: string;
  alleles: { dominant: string; recessive: string };
  phenotypes: { dominant: string; recessive: string };
  /** The genotypes each parent can be set to, e.g. [["BB","Bb","bb"],["BB","Bb","bb"]]. */
  parent_options: [string[], string[]];
  parent_labels?: [string, string];
}

/**
 * A calculation with fresh numbers every time. `question` and `working` use
 * {id} for a variable and {answer} for the answer.
 */
export interface PracticeDiagram {
  kind: "practice";
  alt: string;
  question: string;
  variables: { id: string; min: number; max: number; step: number }[];
  answer: { formula: string; unit?: string; decimals: number; tolerance_percent?: number };
  working: string[];
}

/** Tap a part to learn what it does; then test yourself. */
export interface ExplorerDiagram {
  kind: "explorer";
  alt: string;
  prompt: string;
  parts: { name: string; detail: string }[];
}

export type NoteDiagram =
  | LineGraphDiagram
  | FlowDiagram
  | CompareDiagram
  | PredictorDiagram
  | SliderDiagram
  | SequenceDiagram
  | SortDiagram
  | PunnettDiagram
  | PracticeDiagram
  | ExplorerDiagram;

/** Fills {name} placeholders. Unknown names are left as they are, so a validator can spot them. */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) =>
    k in values ? values[k] : m,
  );
}

/** The values a practice variable can take: min, min+step, … ≤ max. */
export function stepsOf(v: { min: number; max: number; step: number }): number[] {
  const out: number[] = [];
  for (let k = 0; k <= 10_000; k++) {
    const x = +(v.min + k * v.step).toFixed(10);
    if (x > v.max + 1e-9) break;
    out.push(x);
  }
  return out;
}

export interface NoteCheck {
  q: string;
  a: string;
  marks?: number;
}

export interface WorkedExample {
  /** exam_exemplars.id the question was taken from. */
  exemplar_id: string;
  /** e.g. "AQA, June 2022, Paper 1H, Q03.2" */
  source: string;
  question: string;
  marks: number;
  answer_points: string[];
  /** One sentence on how the marks are awarded, if it helps. */
  tip?: string;
}

export interface BoardLayer {
  spec_codes: string[];
  /** Legacy: no longer written or shown (the "Exam tips" section was removed). */
  exam_phrases?: string[];
  mistakes?: { wrong: string; right: string }[];
  worked_example?: WorkedExample;
  /** Board-only content that the shared note doesn't cover. */
  extra?: { heading: string; blocks: NoteBlock[] }[];
}

export interface Note {
  format: typeof NOTE_FORMAT_VERSION;
  concept_id: string;
  subject: "biology" | "chemistry" | "physics";
  title: string;
  key_idea: string;
  sections: { heading: string; blocks: NoteBlock[] }[];
  checks: NoteCheck[];
  boards: Partial<Record<NoteBoard, BoardLayer>>;
  meta: {
    status: "draft" | "approved";
    written_by: string;
    written_at: string;
    spec_point_ids: string[];
    exemplar_ids: string[];
    /** Set by the science check once it has verified the note against its sources. Only checked notes are published. */
    checked_by?: string;
    checked_at?: string;
  };
}

/** A published note that covers a spec point. */
export interface SpecPointNote {
  id: string;
  title: string;
  /** The note written for this point, as opposed to one that also touches it. */
  primary: boolean;
}

// ---------------------------------------------------------------------------
// Validation. Structural only: it proves a note will render, not that it is
// right. Scientific review is a person's job.

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const words = (s: string) => s.trim().split(/\s+/).length;

/** Prose stays light: short paragraphs, and never a wall of them. */
export const MAX_PARAGRAPH_WORDS = 45;
export const MAX_PARAGRAPHS_IN_A_ROW = 2;
const isStrArr = (v: unknown, min = 1): v is string[] =>
  Array.isArray(v) && v.length >= min && v.every(isStr);

function checkBlock(b: unknown, at: string, errs: string[]) {
  const block = b as NoteBlock;
  switch (block?.type) {
    case "paragraph":
      if (!isStr(block.text)) errs.push(`${at}: paragraph needs text`);
      else if (words(block.text) > MAX_PARAGRAPH_WORDS)
        errs.push(
          `${at}: paragraph is ${words(block.text)} words; keep it to ${MAX_PARAGRAPH_WORDS} or split it into a list`,
        );
      break;
    case "subheading":
      if (!isStr(block.text)) errs.push(`${at}: subheading needs text`);
      break;
    case "list":
      if (!isStrArr(block.items, 2)) errs.push(`${at}: list needs 2+ items`);
      break;
    case "definitions":
      if (
        !Array.isArray(block.items) ||
        block.items.length < 1 ||
        !block.items.every((d) => isStr(d?.term) && isStr(d?.meaning))
      )
        errs.push(`${at}: definitions need term and meaning`);
      break;
    case "equation":
      if (!isStr(block.formula)) errs.push(`${at}: equation needs a formula`);
      if (block.where && !isStrArr(block.where))
        errs.push(`${at}: equation.where must be a list of strings`);
      break;
    case "key-points":
      if (!isStrArr(block.items, 2) || block.items.length > 4)
        errs.push(`${at}: key-points need 2–4 items`);
      break;
    case "steps":
      if (
        !Array.isArray(block.items) ||
        block.items.length < 2 ||
        !block.items.every((s) => isStr(s?.lead) && isStr(s?.text))
      )
        errs.push(`${at}: steps need 2+ items with lead and text`);
      break;
    case "table":
      if (!isStrArr(block.columns, 2)) errs.push(`${at}: table needs 2+ columns`);
      else if (
        !Array.isArray(block.rows) ||
        block.rows.length < 1 ||
        !block.rows.every(
          (r) => Array.isArray(r) && r.length === block.columns.length && r.every(isStr),
        )
      )
        errs.push(`${at}: every table row needs ${block.columns.length} cells`);
      break;
    case "diagram":
      checkDiagram(block.diagram, `${at}.diagram`, errs);
      break;
    default:
      errs.push(`${at}: unknown block type ${JSON.stringify((block as { type?: unknown })?.type)}`);
  }
}

function checkDiagram(d: NoteDiagram, at: string, errs: string[]) {
  if (!isStr(d?.alt)) errs.push(`${at}: needs alt text`);
  if (d?.kind === "line-graph") {
    const { x, series } = d;
    if (!x || !(x.max > x.min) || !Array.isArray(x.ticks) || !isStr(x.label))
      errs.push(`${at}: line-graph needs x {label, min < max, ticks}`);
    if (!isStr(d.y?.label)) errs.push(`${at}: line-graph needs y.label`);
    if (d.y?.zero != null && !(d.y.zero >= 0 && d.y.zero <= 1))
      errs.push(`${at}: y.zero must be between 0 and 1`);
    if (!Array.isArray(series) || series.length < 1 || series.length > 5)
      errs.push(`${at}: line-graph needs 1–5 series`);
    else
      for (const s of series) {
        if (!isStr(s.name) || !Array.isArray(s.points) || s.points.length < 2)
          errs.push(`${at}: series needs a name and 2+ points`);
        else if (s.points.some(([px, py]) => px < x.min || px > x.max || py < 0 || py > 1))
          errs.push(`${at}: series "${s.name}" has a point outside x ${x.min}–${x.max} or y 0–1`);
      }
  } else if (d?.kind === "flow") {
    if (!isStrArr(d.steps, 2) || d.steps.length > 7) errs.push(`${at}: flow needs 2–7 steps`);
  } else if (d?.kind === "compare") {
    if (!isStrArr(d.items, 2) || d.items.length > 4) errs.push(`${at}: compare needs 2–4 items`);
    else if (
      !Array.isArray(d.rows) ||
      !d.rows.every(
        (r) => isStr(r.feature) && Array.isArray(r.values) && r.values.length === d.items.length,
      )
    )
      errs.push(`${at}: every compare row needs ${d.items.length} values`);
  } else if (d?.kind === "predictor") {
    if (!isStr(d.prompt)) errs.push(`${at}: predictor needs a prompt`);
    if (!isStrArr(d.result_labels) || d.result_labels.length > 5)
      errs.push(`${at}: predictor needs 1–5 result_labels`);
    else if (!Array.isArray(d.options) || d.options.length < 2 || d.options.length > 10)
      errs.push(`${at}: predictor needs 2–10 options`);
    else
      for (const o of d.options)
        if (
          !isStr(o?.label) ||
          !Array.isArray(o.results) ||
          o.results.length !== d.result_labels.length ||
          !o.results.every(isStr)
        )
          errs.push(
            `${at}: option "${o?.label}" needs a label and ${d.result_labels.length} results`,
          );
    if (Array.isArray(d.options)) {
      const withScene = d.options.filter((o) => o?.scene).length;
      if (withScene && withScene !== d.options.length)
        errs.push(`${at}: if one option has a scene, every option needs one`);
      for (const o of d.options)
        if (o?.scene) checkPredictorScene(o.scene, `${at} option "${o.label}"`, errs);
    }
  } else if (d?.kind === "slider") {
    checkSlider(d, at, errs);
  } else if (d?.kind === "sequence") {
    if (!isStr(d.prompt)) errs.push(`${at}: sequence needs a prompt`);
    if (!isStrArr(d.steps, 3) || d.steps.length > 8) errs.push(`${at}: sequence needs 3–8 steps`);
    else if (new Set(d.steps).size !== d.steps.length)
      errs.push(`${at}: sequence steps must all be different`);
  } else if (d?.kind === "sort") {
    if (!isStr(d.prompt)) errs.push(`${at}: sort needs a prompt`);
    if (!isStrArr(d.groups, 2) || d.groups.length > 3) errs.push(`${at}: sort needs 2–3 groups`);
    else if (!Array.isArray(d.items) || d.items.length < 4 || d.items.length > 12)
      errs.push(`${at}: sort needs 4–12 items`);
    else {
      if (
        !d.items.every(
          (i) =>
            isStr(i?.text) &&
            Number.isInteger(i.group) &&
            i.group >= 0 &&
            i.group < d.groups.length,
        )
      )
        errs.push(`${at}: every sort item needs text and a group index 0–${d.groups.length - 1}`);
      if (d.groups.some((_, g) => !d.items.some((i) => i.group === g)))
        errs.push(`${at}: every sort group needs at least one item`);
    }
  } else if (d?.kind === "punnett") {
    const { dominant: D, recessive: r } = d.alleles ?? ({} as PunnettDiagram["alleles"]);
    if (!/^[A-Za-z]$/.test(D ?? "") || !/^[A-Za-z]$/.test(r ?? "") || D === r)
      errs.push(`${at}: punnett alleles must be two different single letters`);
    if (!isStr(d.phenotypes?.dominant) || !isStr(d.phenotypes?.recessive))
      errs.push(`${at}: punnett needs both phenotypes`);
    if (!Array.isArray(d.parent_options) || d.parent_options.length !== 2)
      errs.push(`${at}: punnett needs parent_options for two parents`);
    else
      for (const opts of d.parent_options)
        if (
          !Array.isArray(opts) ||
          opts.length < 1 ||
          !opts.every(
            (g) =>
              typeof g === "string" && g.length === 2 && [...g].every((c) => c === D || c === r),
          )
        )
          errs.push(`${at}: every punnett genotype must be two letters, each ${D} or ${r}`);
  } else if (d?.kind === "practice") {
    checkPractice(d, at, errs);
  } else if (d?.kind === "explorer") {
    if (!isStr(d.prompt)) errs.push(`${at}: explorer needs a prompt`);
    if (
      !Array.isArray(d.parts) ||
      d.parts.length < 3 ||
      d.parts.length > 12 ||
      !d.parts.every((p) => isStr(p?.name) && isStr(p?.detail))
    )
      errs.push(`${at}: explorer needs 3–12 parts with name and detail`);
    else if (new Set(d.parts.map((p) => p.name)).size !== d.parts.length)
      errs.push(`${at}: explorer part names must be different`);
  } else errs.push(`${at}: unknown diagram kind`);
}

function checkPractice(d: PracticeDiagram, at: string, errs: string[]) {
  if (!isStr(d.question)) errs.push(`${at}: practice needs a question`);
  if (!Array.isArray(d.variables) || d.variables.length < 1 || d.variables.length > 4) {
    errs.push(`${at}: practice needs 1–4 variables`);
    return;
  }
  for (const v of d.variables)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v?.id ?? "") || !(v.max >= v.min) || !(v.step > 0))
      errs.push(`${at}: variable ${v?.id} needs an id, min ≤ max and step > 0`);
  if (!isStr(d.answer?.formula) || !Number.isInteger(d.answer?.decimals) || d.answer.decimals < 0) {
    errs.push(`${at}: practice answer needs a formula and whole-number decimals`);
    return;
  }
  if (!isStrArr(d.working, 1)) errs.push(`${at}: practice needs working steps`);
  const ids = new Set(d.variables.map((v) => v.id));
  const known = new Set([...ids, "answer"]);
  for (const t of [d.question, ...(d.working ?? [])])
    for (const [, k] of t.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g))
      if (!known.has(k)) errs.push(`${at}: "{${k}}" is not a variable`);
  try {
    const tree = parseFormula(d.answer.formula);
    const unknown = [...variablesOf(tree)].filter((v) => !ids.has(v));
    if (unknown.length) {
      errs.push(`${at}: answer formula uses ${unknown.join(", ")}, which are not variables`);
      return;
    }
    // Try every corner of the variable ranges: the answer must always be a finite number.
    const ranges = d.variables.map((v) => [v.min, v.max]);
    const corners = ranges.reduce<number[][]>(
      (acc, r) => acc.flatMap((c) => r.map((x) => [...c, x])),
      [[]],
    );
    for (const c of corners) {
      const vars = Object.fromEntries(d.variables.map((v, i) => [v.id, c[i]]));
      if (!Number.isFinite(evaluate(tree, vars))) {
        errs.push(`${at}: answer is not a finite number for ${JSON.stringify(vars)}`);
        break;
      }
    }
  } catch (e) {
    errs.push(`${at}: answer formula: ${(e as Error).message}`);
  }
}

const isColour = (c: unknown) => (SCENE_COLOURS as readonly unknown[]).includes(c);

function checkPredictorScene(s: PredictorScene, at: string, errs: string[]) {
  if (s.kind === "electrolysis") {
    if (!Array.isArray(s.ions) || s.ions.length !== 2 || !s.ions.every(isStr))
      errs.push(`${at}: electrolysis scene needs two ions`);
    if (!isStr(s.negative?.product) || !["gas", "metal"].includes(s.negative?.form))
      errs.push(`${at}: negative electrode needs a product and form gas or metal`);
    if (!isStr(s.positive?.product) || !["gas", "solution"].includes(s.positive?.form))
      errs.push(`${at}: positive electrode needs a product and form gas or solution`);
  } else if (s.kind === "tubes") {
    if (!Array.isArray(s.tubes) || s.tubes.length < 1 || s.tubes.length > 6)
      errs.push(`${at}: tubes scene needs 1–6 tubes`);
    else
      for (const t of s.tubes) {
        if (!isStr(t?.label) || !isColour(t.colour))
          errs.push(`${at}: every tube needs a label and a colour from SCENE_COLOURS`);
        if (t?.precipitate != null && !isColour(t.precipitate))
          errs.push(`${at}: precipitate colour must be one of SCENE_COLOURS`);
      }
  } else if (s.kind === "flame") {
    if (!isColour(s.colour)) errs.push(`${at}: flame colour must be one of SCENE_COLOURS`);
  } else if (s.kind === "energy-profile") {
    if (!["exothermic", "endothermic"].includes(s.direction))
      errs.push(`${at}: energy profile direction must be exothermic or endothermic`);
  } else errs.push(`${at}: unknown scene ${JSON.stringify((s as { kind?: unknown }).kind)}`);
}

function checkSlider(d: SliderDiagram, at: string, errs: string[]) {
  if (!Array.isArray(d.inputs) || d.inputs.length < 1 || d.inputs.length > 4) {
    errs.push(`${at}: slider needs 1–4 inputs`);
    return;
  }
  if (!Array.isArray(d.outputs) || d.outputs.length < 1 || d.outputs.length > 4) {
    errs.push(`${at}: slider needs 1–4 outputs`);
    return;
  }
  const ids = new Set<string>();
  for (const i of d.inputs) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(i?.id ?? "") || !isStr(i.label)) {
      errs.push(`${at}: every input needs an id (letters, digits, _) and a label`);
      continue;
    }
    ids.add(i.id);
    if ("choices" in i) {
      if (
        !Array.isArray(i.choices) ||
        i.choices.length < 2 ||
        !i.choices.every((c) => isStr(c.label) && Number.isFinite(c.value))
      )
        errs.push(`${at}: input ${i.id} needs 2+ choices with label and value`);
      else if (new Set(i.choices.map((c) => c.value)).size !== i.choices.length)
        errs.push(`${at}: input ${i.id} has two choices with the same value`);
    } else if (!(i.max > i.min) || !(i.step > 0) || !(i.value >= i.min && i.value <= i.max)) {
      errs.push(`${at}: input ${i.id} needs min < max, step > 0 and min ≤ value ≤ max`);
    }
  }
  // Every formula must parse, use only the inputs, and give a finite number at both ends of every slider.
  const corners = [
    Object.fromEntries(d.inputs.map((i) => [i.id, "choices" in i ? i.choices[0]?.value : i.min])),
    Object.fromEntries(
      d.inputs.map((i) => [i.id, "choices" in i ? i.choices[i.choices.length - 1]?.value : i.max]),
    ),
  ];
  for (const o of d.outputs) {
    if (!isStr(o?.label) || !isStr(o.formula)) {
      errs.push(`${at}: every output needs a label and a formula`);
      continue;
    }
    try {
      const tree = parseFormula(o.formula);
      const unknown = [...variablesOf(tree)].filter((v) => !ids.has(v));
      if (unknown.length)
        errs.push(`${at}: output "${o.label}" uses ${unknown.join(", ")}, which are not inputs`);
      else if (
        corners.some((vars) => !Number.isFinite(evaluate(tree, vars as Record<string, number>)))
      )
        errs.push(`${at}: output "${o.label}" is not a finite number at the ends of its sliders`);
    } catch (e) {
      errs.push(`${at}: output "${o.label}" formula: ${(e as Error).message}`);
    }
  }
  const sc = d.scene;
  if (!sc) return;
  const sliderIds = new Set(d.inputs.filter((i) => !("choices" in i)).map((i) => i.id));
  const isOut = (n: number) => Number.isInteger(n) && n >= 0 && n < d.outputs.length;
  if (sc.kind === "road") {
    if (!isOut(sc.thinking) || !isOut(sc.braking))
      errs.push(`${at}: road scene needs thinking and braking output indexes`);
  } else if (sc.kind === "wave") {
    if (!ids.has(sc.amplitude) || !ids.has(sc.frequency))
      errs.push(`${at}: wave scene needs amplitude and frequency input ids`);
  } else if (sc.kind === "particles") {
    if (!sliderIds.has(sc.temperature))
      errs.push(`${at}: particles scene needs a temperature slider id`);
    if (!(sc.boiling > sc.melting)) errs.push(`${at}: particles scene needs melting < boiling`);
  } else if (sc.kind === "half-life") {
    if (!sliderIds.has(sc.time)) errs.push(`${at}: half-life scene needs a time slider id`);
    if (!(sc.half_life > 0)) errs.push(`${at}: half-life must be positive`);
  } else if (sc.kind === "gas-syringe") {
    if (!isOut(sc.volume) || (sc.rate != null && !isOut(sc.rate)))
      errs.push(`${at}: gas-syringe scene needs a volume (and optional rate) output index`);
    if (!(sc.max > 0)) errs.push(`${at}: gas-syringe max must be positive`);
  } else if (sc.kind === "circuit") {
    if (!["series", "parallel"].includes(sc.arrangement))
      errs.push(`${at}: circuit arrangement must be series or parallel`);
    if (!isOut(sc.brightness) || !(sc.max > 0))
      errs.push(`${at}: circuit scene needs a brightness output index and max > 0`);
  } else if (sc.kind === "enzyme") {
    if (!ids.has(sc.condition)) errs.push(`${at}: enzyme scene needs a condition input id`);
    if (!(sc.denatures_at > 0)) errs.push(`${at}: enzyme denatures_at must be positive`);
  } else if (sc.kind === "diffusion") {
    if (!ids.has(sc.left) || !ids.has(sc.right))
      errs.push(`${at}: diffusion scene needs left and right input ids`);
  } else if (sc.kind === "ph") {
    const p = d.inputs.find((i) => i.id === sc.ph);
    if (!p) errs.push(`${at}: ph scene needs a ph input id`);
    else if (!("choices" in p) && (p.min < 0 || p.max > 14))
      errs.push(`${at}: the pH slider must stay within 0–14`);
  } else errs.push(`${at}: unknown scene ${JSON.stringify((sc as { kind?: unknown }).kind)}`);
}

export function validateNote(n: unknown): string[] {
  const errs: string[] = [];
  const note = n as Note;
  if (note?.format !== NOTE_FORMAT_VERSION) errs.push(`format must be ${NOTE_FORMAT_VERSION}`);
  for (const k of ["concept_id", "title", "key_idea"] as const)
    if (!isStr(note?.[k])) errs.push(`${k} is required`);
  if (!["biology", "chemistry", "physics"].includes(note?.subject)) errs.push("subject is invalid");
  if (!Array.isArray(note?.sections) || note.sections.length < 1)
    errs.push("needs at least one section");
  else
    note.sections.forEach((s, i) => {
      if (!isStr(s?.heading)) errs.push(`sections[${i}]: heading is required`);
      if (!Array.isArray(s?.blocks) || s.blocks.length < 1)
        errs.push(`sections[${i}]: needs blocks`);
      else {
        s.blocks.forEach((b, j) => checkBlock(b, `sections[${i}].blocks[${j}]`, errs));
        let run = 0;
        for (const b of s.blocks) {
          run = b.type === "paragraph" ? run + 1 : 0;
          if (run > MAX_PARAGRAPHS_IN_A_ROW) {
            errs.push(
              `sections[${i}]: more than ${MAX_PARAGRAPHS_IN_A_ROW} paragraphs in a row; break them up with a list, definitions, an equation or a subheading`,
            );
            break;
          }
        }
      }
    });
  if (
    !Array.isArray(note?.checks) ||
    note.checks.length < 2 ||
    !note.checks.every((c) => isStr(c?.q) && isStr(c?.a))
  )
    errs.push("needs 2+ checks with q and a");
  const boards = Object.keys(note?.boards ?? {});
  if (boards.length < 1) errs.push("needs at least one board layer");
  for (const b of boards) {
    if (!(NOTE_BOARDS as readonly string[]).includes(b)) {
      errs.push(`boards.${b}: unknown board`);
      continue;
    }
    const l = note.boards[b as NoteBoard]!;
    if (!isStrArr(l.spec_codes)) errs.push(`boards.${b}: spec_codes required`);
    const w = l.worked_example;
    if (
      w &&
      (!isStr(w.exemplar_id) ||
        !isStr(w.source) ||
        !isStr(w.question) ||
        !(w.marks > 0) ||
        !isStrArr(w.answer_points))
    )
      errs.push(`boards.${b}: worked_example is incomplete`);
    l.extra?.forEach((s, i) =>
      s.blocks.forEach((blk, j) => checkBlock(blk, `boards.${b}.extra[${i}].blocks[${j}]`, errs)),
    );
  }
  if (!["draft", "approved"].includes(note?.meta?.status))
    errs.push("meta.status must be draft or approved");
  if (isStr(note?.key_idea) && words(note.key_idea) > 50)
    errs.push(`key_idea is ${words(note.key_idea)} words; keep it under 50`);
  if (!isStr(note?.meta?.written_by)) errs.push("meta.written_by is required");
  if (!Array.isArray(note?.meta?.spec_point_ids) || note.meta.spec_point_ids.length < 1)
    errs.push("meta.spec_point_ids required");
  return errs;
}

/** Splits text on **bold** markers into plain and bold runs. */
export function inlineRuns(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((t) =>
      t.startsWith("**") && t.endsWith("**")
        ? { text: t.slice(2, -2), bold: true }
        : { text: t, bold: false },
    );
}
