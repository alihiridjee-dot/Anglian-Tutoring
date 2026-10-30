/**
 * A figure kind drawn by code, in a file of its own: what the writer is told
 * to brief, how the brief is checked, how it is drawn, what the checker holds
 * the drawing to, and example questions. `kinds/index.ts` lists every one;
 * readBrief, drawWithCode and checkFigure each ask it for a kind they don't
 * know themselves, so a new kind is one new file and one line there.
 */
import type { CheckTools, Drawing } from "../figureCheck";
import type { DrawnFigure } from "../figureDraw";
import type { FigureRequest } from "../figurePrompt";

/** A brief as a kind file reads it: its kind and its own fields. */
export type KindBrief = { kind: string };

export type FigureKind<B extends KindBrief = KindBrief> = {
  kind: B["kind"];
  /** How the writer's guide names it among the figures it may brief: "a pie chart". */
  name: string;
  /**
   * The writer's rule for the brief, after `- "kind": ` in the guide: every
   * field, what each holds, and the limits that make it fit.
   */
  guide: string;
  /**
   * The brief checked and tidied, or what is wrong with it in words the
   * writer's log can show. `fits` draws a brief and returns the checker's
   * problems, for a kind whose room depends on more than its own fields.
   * Any brief this accepts must draw and pass the checker.
   */
  read: (
    b: Record<string, unknown>,
    fits: (brief: B) => string[],
  ) => { brief: B } | { problem: string };
  /** The drawing and its alt text, which says what is drawn and never what it means. */
  draw: (b: B) => DrawnFigure;
  /**
   * What the drawing gets wrong against the brief: everything an answer hangs
   * on, and anything drawn that the brief doesn't name. The checker has
   * already held it to the canvas, the elements and the text rules.
   */
  check: (b: B, d: Drawing, t: CheckTools) => string[];
  /** Questions with their briefs: shown on /figures-preview, and each must pass. */
  samples: FigureRequest[];
  /** A random brief, for the sweep: any that passes `read` must draw and pass. */
  random: (r: () => number) => unknown;
};
