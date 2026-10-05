import { describe, expect, test } from "bun:test";
import { computePacing, withWeeklyPoints, type PacingBand } from "./pacing";
import { resumeAfterPause, type OrderTopic } from "./topicOrder";
import { weekKeyToDate } from "./week";
import {
  backOn,
  breakCovering,
  breakEndsOn,
  fullerBy,
  layBreaksOver,
  mondayKeyOf,
  overlapsBreak,
  runWeeks,
  shiftKey,
  touchesExam,
  type StudentBreak,
} from "./breaks";

const brk = (startsOn: string, endsOn: string): StudentBreak => ({
  id: startsOn,
  startsOn,
  endsOn,
  reason: "holiday",
  recordedAt: null,
});

describe("break dates", () => {
  test("a break runs Monday to Sunday, and the student is back the Monday after", () => {
    expect(breakEndsOn("2026-10-12", 2)).toBe("2026-10-25");
    expect(backOn({ endsOn: "2026-10-25" })).toBe("2026-10-26");
    expect(shiftKey("2026-12-28", 7)).toBe("2027-01-04");
  });
  test("any day finds the Monday of its week", () => {
    expect(mondayKeyOf("2026-10-14")).toBe("2026-10-12");
    expect(mondayKeyOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayKeyOf("2026-10-12")).toBe("2026-10-12");
  });
  test("a week falls in the break that covers it", () => {
    const breaks = [brk("2026-10-12", "2026-10-25")];
    expect(breakCovering(breaks, "2026-10-12")?.id).toBe("2026-10-12");
    expect(breakCovering(breaks, "2026-10-19")?.id).toBe("2026-10-12");
    expect(breakCovering(breaks, "2026-10-26")).toBeNull();
    expect(breakCovering(breaks, "2026-10-05")).toBeNull();
  });
});

describe("the booking rules, as the form checks them", () => {
  const booked = [brk("2026-10-12", "2026-10-25"), brk("2026-11-02", "2026-11-08")];
  test("breaks that touch count as one run", () => {
    expect(runWeeks(booked, "2026-10-26", 1)).toBe(4); // joins both: 2 + 1 + 1
    expect(runWeeks([booked[0]], "2026-10-26", 3)).toBe(5); // runs on from the first
    expect(runWeeks(booked, "2026-10-05", 1)).toBe(3); // in front of the first
    expect(runWeeks(booked, "2026-12-07", 3)).toBe(3); // touching none
  });
  test("a break can't overlap one already booked", () => {
    expect(overlapsBreak(booked, "2026-10-19", 1)).toBe(true);
    expect(overlapsBreak(booked, "2026-10-05", 2)).toBe(true);
    expect(overlapsBreak(booked, "2026-10-26", 1)).toBe(false);
  });
  test("none in the 6 weeks before an exam, or in the exam week", () => {
    // Exam Monday 7 June: 26 April to 13 June is kept clear.
    expect(touchesExam({ startsOn: "2027-04-19", weeks: 1, examDate: "2027-06-07" })).toBe(false);
    expect(touchesExam({ startsOn: "2027-04-19", weeks: 2, examDate: "2027-06-07" })).toBe(true);
    expect(touchesExam({ startsOn: "2027-06-07", weeks: 1, examDate: "2027-06-07" })).toBe(true);
    expect(touchesExam({ startsOn: "2027-06-14", weeks: 1, examDate: "2027-06-07" })).toBe(false);
    // An exam on a Wednesday counts from its Monday.
    expect(touchesExam({ startsOn: "2027-05-10", weeks: 1, examDate: "2027-06-23" })).toBe(true);
    expect(touchesExam({ startsOn: "2027-05-03", weeks: 1, examDate: "2027-06-23" })).toBe(false);
  });
  test("each week after gets fuller by the weeks the break takes out", () => {
    // 34 weeks from 12 Oct to the exam week; a 2-week break leaves 32 to carry them.
    expect(fullerBy({ startsOn: "2026-10-12", weeks: 2, examDate: "2027-06-07" })).toBeCloseTo(
      34 / 32 - 1,
    );
    // With 8 weeks left, the same break makes each week a third fuller.
    expect(fullerBy({ startsOn: "2027-04-12", weeks: 2, examDate: "2027-06-07" })).toBeCloseTo(
      8 / 6 - 1,
    );
    expect(fullerBy({ startsOn: "2027-05-24", weeks: 2, examDate: "2027-06-07" })).toBeNull();
  });
});

describe("laying breaks over the spine", () => {
  const examDate = "2026-12-14";
  const topics: OrderTopic[] = ["a", "b", "c"].map((id, i) => ({
    topicId: id,
    title: id,
    points: Array.from({ length: 4 }, (_, j) => ({
      specPointId: `${id}${j}`,
      code: `${id}${j}`,
      title: `${id}${j}`,
      weight: i + 1,
    })),
  }));
  const bands = withWeeklyPoints(
    computePacing(
      topics.map((t) => ({ ...t, weight: t.points.reduce((s, p) => s + p.weight!, 0) })),
      weekKeyToDate("2026-08-31"),
      weekKeyToDate(examDate),
    ),
    new Map(topics.map((t) => [t.topicId, t.points])),
  );
  const scheduled = (spine: PacingBand[]) =>
    spine
      .flatMap((b) =>
        Object.entries(b.pointsByWeek ?? {}).flatMap(([week, ps]) =>
          ps.map((p) => `${week} ${p.specPointId}`),
        ),
      )
      .sort();
  const october = brk("2026-10-12", "2026-10-25");
  const november = brk("2026-11-09", "2026-11-15");
  const lay = (breaks: StudentBreak[], spine = bands) =>
    layBreaksOver({ bands: spine, topics, breaks, examDate });

  test("a break is the move a billing pause makes when it ends", () => {
    expect(scheduled(lay([october]))).toEqual(
      scheduled(
        resumeAfterPause({
          bands,
          topics,
          pausedFrom: "2026-10-12",
          resumeFrom: "2026-10-26",
          examDate,
        }),
      ),
    );
  });
  test("nothing is taught in the break, and nothing before it moves", () => {
    const laid = scheduled(lay([october]));
    expect(laid.filter((s) => s >= "2026-10-12" && s < "2026-10-26")).toEqual([]);
    expect(laid.filter((s) => s < "2026-10-12")).toEqual(
      scheduled(bands).filter((s) => s < "2026-10-12"),
    );
    expect(laid.length).toBe(scheduled(bands).length);
  });
  test("laying it again changes nothing, so saving it once it's over can't jolt the plan", () => {
    const once = lay([october]);
    expect(scheduled(lay([october], once))).toEqual(scheduled(once));
    const both = lay([october, november]);
    expect(scheduled(lay([october, november], both))).toEqual(scheduled(both));
  });
  test("breaks are laid oldest first, whatever order they come in", () => {
    expect(scheduled(lay([november, october]))).toEqual(scheduled(lay([october, november])));
  });
  test("a break that can't be fitted leaves the spine as it was", () => {
    expect(lay([brk("2026-12-14", "2026-12-20")])).toBe(bands); // the exams have begun
    expect(lay([])).toBe(bands);
  });
});
