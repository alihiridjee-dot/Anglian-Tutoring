import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { paperAsFiled } from "../../../supabase/functions/mark-homework/marker";
import {
  HEAVIEST_LIVE_LOAD,
  HELD_QUESTION_LOADS,
  QUESTION_CAPS,
  QUESTION_LOADS,
  firstQuestions,
  isQuestionLoad,
  liveLoad,
  loadCut,
  minutesPerDay,
  minutesPerTopic,
  readLoad,
  setCount,
  shownCount,
  TOPICS_PER_WEEK_PER_SUBJECT,
} from "./questionLoad";

describe("the levels' caps", () => {
  test("Ali's levels of 26 Nov 2026: 6 and 3, 8 and 5, 10 and 7", () => {
    expect(QUESTION_CAPS).toEqual({
      reduced: { quiz: 6, task: 3 },
      normal: { quiz: 8, task: 5 },
      enhanced: { quiz: 10, task: 7 },
    });
  });

  test("a student is set the level's cap or what is stored, whichever is smaller", () => {
    // A full set, as the queue writes them from now on.
    expect(QUESTION_LOADS.map((load) => shownCount("quiz", 10, load))).toEqual([6, 8, 10]);
    expect(QUESTION_LOADS.map((load) => shownCount("task", 7, load))).toEqual([3, 5, 7]);
    // Written before the levels (8 and 5): Enhanced sees the same as Normal.
    expect(QUESTION_LOADS.map((load) => shownCount("quiz", 8, load))).toEqual([6, 8, 8]);
    expect(QUESTION_LOADS.map((load) => shownCount("task", 5, load))).toEqual([3, 5, 5]);
    // Short sets, where questions were dropped by the queue's checks.
    expect(QUESTION_LOADS.map((load) => shownCount("quiz", 6, load))).toEqual([6, 6, 6]);
    expect(QUESTION_LOADS.map((load) => shownCount("task", 4, load))).toEqual([3, 4, 4]);
    expect(shownCount("quiz", 0, "enhanced")).toBe(0);
  });

  test("only a point's shared quiz or task is cut; a tutor's own is set whole", () => {
    expect(setCount("quiz", "generated", 8, "reduced")).toBe(6);
    expect(setCount("task", "generated", 5, "reduced")).toBe(3);
    expect(setCount("quiz", "tutor", 8, "reduced")).toBeNull();
    expect(setCount("task", undefined, 5, "reduced")).toBeNull();
  });

  test("only the three levels are levels", () => {
    expect(QUESTION_LOADS.every(isQuestionLoad)).toBe(true);
    expect(isQuestionLoad("huge")).toBe(false);
    expect(isQuestionLoad(null)).toBe(false);
  });

  // The server works the count out itself when it marks. Its copy of the caps
  // is the one function in the migration; this holds the two to one set of
  // numbers. scripts/test-question-load-db.ts runs that function against
  // shownCount for every level and stored count.
  test("private.shown_question_count holds the same caps", () => {
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    const [file, ...others] = readdirSync(dir).filter((f) => f.endsWith("_question_load.sql"));
    expect(others).toEqual([]);
    const sql = readFileSync(new URL(file, dir), "utf8");
    for (const kind of ["quiz", "task"] as const) {
      const { reduced, normal, enhanced } = QUESTION_CAPS;
      expect(sql).toContain(
        `when '${kind}' then case _load when 'reduced' then ${reduced[kind]} when 'enhanced' then ${enhanced[kind]} else ${normal[kind]} end`,
      );
    }
  });
});

describe("Enhanced is held back for now (Ali, 26 Nov 2026)", () => {
  test("it counts as Normal wherever a level is read or picked", () => {
    expect(HELD_QUESTION_LOADS).toEqual(["enhanced"]);
    expect(QUESTION_LOADS.map(liveLoad)).toEqual(["reduced", "normal", "normal"]);
  });

  // The queue writes for the heaviest level on offer. Ten and seven would cost
  // about 20% more a call, for questions nobody could be set.
  test("so the practice queue still writes 8 MCQs and 5 written questions", () => {
    expect(HEAVIEST_LIVE_LOAD).toBe("normal");
    expect(QUESTION_CAPS[HEAVIEST_LIVE_LOAD]).toEqual({ quiz: 8, task: 5 });
  });
});

describe("the level a tutor and a parent are shown", () => {
  test("a stored level reads as itself, and a held one as Normal", () => {
    expect(readLoad("reduced")).toBe("reduced");
    expect(readLoad("normal")).toBe("normal");
    for (const held of HELD_QUESTION_LOADS) expect(readLoad(held)).toBe("normal");
  });

  test("anything that is not a level reads as Normal", () => {
    for (const value of [null, undefined, "", "Reduced", "light", 3, {}]) {
      expect(readLoad(value)).toBe("normal");
    }
  });
});

describe("what a level left out of one piece of work", () => {
  test("a task set three of its five questions was cut by Reduced", () => {
    expect(loadCut("task", 3, 5)).toEqual({ set: 3, leftOut: 2, load: "reduced" });
  });

  test("a quiz set six of its eight questions was cut by Reduced", () => {
    expect(loadCut("quiz", 6, 8)).toEqual({ set: 6, leftOut: 2, load: "reduced" });
  });

  test("work set whole was not cut, whatever the level", () => {
    // Normal on a set written before the levels: five of five, eight of eight.
    expect(loadCut("task", 5, 5)).toBeNull();
    expect(loadCut("quiz", 8, 8)).toBeNull();
    // Reduced on a task the queue's checks had already shortened to three.
    expect(loadCut("task", 3, 3)).toBeNull();
    // A count above what is stored now (a question removed since) is not a cut.
    expect(loadCut("task", 5, 4)).toBeNull();
  });

  test("work filed without a count was set every question", () => {
    expect(loadCut("task", null, 5)).toBeNull();
    expect(loadCut("quiz", undefined, 8)).toBeNull();
  });

  test("Normal is named once a longer set is stored", () => {
    expect(loadCut("task", 5, 7)).toEqual({ set: 5, leftOut: 2, load: "normal" });
    expect(loadCut("quiz", 8, 10)).toEqual({ set: 8, leftOut: 2, load: "normal" });
  });

  test("a count no level sets is still counted, with no level named", () => {
    expect(loadCut("task", 2, 5)).toEqual({ set: 2, leftOut: 3, load: null });
    expect(loadCut("task", -1, 5)).toEqual({ set: 0, leftOut: 5, load: null });
  });

  test("the level is the one whose cap for that kind of work is the count", () => {
    // Six is Reduced's quiz cap and no level's task cap.
    expect(loadCut("quiz", 6, 10)?.load).toBe("reduced");
    expect(loadCut("task", 6, 7)?.load).toBeNull();
  });
});

describe("the first questions", () => {
  const q = (id: string, position: number) => ({ id, position });

  test("by position, and by id where positions tie", () => {
    const stored = [q("d", 2), q("c", 0), q("a", 1), q("b", 1)];
    expect(firstQuestions(stored, 3).map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(firstQuestions(stored, 9).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
    expect(firstQuestions(stored, 0)).toEqual([]);
  });

  test("no count is every question, as given", () => {
    const stored = [q("d", 2), q("c", 0)];
    expect(firstQuestions(stored, null)).toBe(stored);
  });
});

describe("the paper as it was handed in (the marker's copy of the rule)", () => {
  const questions = [{ id: "q1" }, { id: "q2" }, { id: "q3" }, { id: "q4" }, { id: "q5" }];

  test("work filed with a count is the questions it has an answer row for", () => {
    // Hand-in wrote a row for each of the three set, the blank one included.
    const answers = new Map<string, string | null>([
      ["q1", "an answer"],
      ["q2", null],
      ["q3", "another"],
    ]);
    expect(paperAsFiled(questions, answers, 3).map((x) => x.id)).toEqual(["q1", "q2", "q3"]);
  });

  test("work with no count is every question on the sheet, as before the levels", () => {
    const answers = new Map<string, string | null>([["q1", "an answer"]]);
    expect(paperAsFiled(questions, answers, null)).toBe(questions);
    expect(paperAsFiled(questions, answers, undefined)).toBe(questions);
  });
});

describe("minutes", () => {
  test("a topic at a minute a mark: about 16, 28 and 41", () => {
    expect(QUESTION_LOADS.map(minutesPerTopic)).toEqual([16, 28, 41]);
  });

  test("a day at sign-up is one topic a day for each subject, to the nearest five", () => {
    const perDay = (subjects: number) =>
      QUESTION_LOADS.map((load) => minutesPerDay(load, subjects * TOPICS_PER_WEEK_PER_SUBJECT));
    expect(perDay(1)).toEqual([15, 30, 40]);
    expect(perDay(2)).toEqual([30, 55, 80]);
    expect(perDay(3)).toEqual([50, 85, 125]);
  });

  test("a day on the profile is this week's points over seven days", () => {
    expect(QUESTION_LOADS.map((load) => minutesPerDay(load, 12))).toEqual([25, 50, 70]);
    // A light week still shows a figure, never nought.
    expect(minutesPerDay("reduced", 1)).toBe(5);
    expect(minutesPerDay("reduced", 0)).toBe(5);
  });
});
