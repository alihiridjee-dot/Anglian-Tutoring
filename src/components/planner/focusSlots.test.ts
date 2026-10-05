import { expect, test } from "bun:test";
import { compareFocus, type SeenFocus } from "./focusSlots";
import type { PacingBand } from "@/lib/planner/pacing";

const BIOLOGY = "student|biology|edexcel|gcse";
const CHEMISTRY = "student|chemistry|edexcel|gcse";

const teach = (topicId: string, startWeek: string, endWeek: string): PacingBand => ({
  topicId,
  title: `Topic ${topicId}`,
  startWeek,
  endWeek,
  weeks: 1,
  kind: "teach",
});
const review = (topicId: string, week: string): PacingBand => ({
  topicId,
  title: `Topic ${topicId}`,
  startWeek: week,
  endWeek: week,
  weeks: 1,
  kind: "revisit",
  points: [{ specPointId: `${topicId}-1`, code: "1.1", title: "Point" }],
});

// The test student's Biology on 5 Oct 2026: teaching, and one review slot.
const plan = [teach("t1", "2026-09-21", "2026-10-11"), review("t1", "2026-10-12")];

/** What StudentPlanner's effect does with each roadmap the query hands it, in turn. */
function watch(course: string, ...loads: (PacingBand[] | null)[]) {
  let seen: SeenFocus | null = null;
  let added = new Set<string>();
  for (const bands of loads) {
    const next = compareFocus(seen, course, bands);
    if (!next) continue;
    seen = next.seen;
    added = next.added;
  }
  return added;
}

test("a fresh visit flags nothing: the plan still loading is not a plan with no reviews", () => {
  // The query has no data on the first render, then the plan arrives. The
  // loading state used to be remembered as an empty plan, so every review
  // slot read as new on every visit.
  expect(watch(BIOLOGY, null, plan)).toEqual(new Set());
  expect(compareFocus(null, BIOLOGY, null)).toBeNull();
});

test("a review slot added since the last plan seen is flagged", () => {
  const more = [...plan, review("t2", "2026-10-05")];
  expect(watch(BIOLOGY, null, plan, more)).toEqual(new Set(["t2|revisit|2026-10-05"]));
});

test("a review slot moved to another week is flagged at its new week", () => {
  const moved = [plan[0], review("t1", "2026-10-19")];
  expect(watch(BIOLOGY, plan, moved)).toEqual(new Set(["t1|revisit|2026-10-19"]));
});

test("the same plan loaded again flags nothing", () => {
  expect(watch(BIOLOGY, null, plan, [...plan])).toEqual(new Set());
});

test("teaching is not the focus lane: a moved teach band flags nothing", () => {
  const later = [teach("t1", "2026-09-28", "2026-10-18"), plan[1]];
  expect(watch(BIOLOGY, plan, later)).toEqual(new Set());
});

test("another course starts afresh, with nothing flagged", () => {
  const seen = compareFocus(null, BIOLOGY, plan)!.seen;
  expect(compareFocus(seen, CHEMISTRY, [review("c1", "2026-10-05")])!.added).toEqual(new Set());
});
