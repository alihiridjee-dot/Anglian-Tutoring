import { describe, expect, it } from "bun:test";
import {
  MIN_WORK_FOR_PREDICTION,
  hasPrediction,
  summariseAnalytics,
  trendWeeks,
} from "./analytics";

const quiz = (pct: number) => ({ subject: "chemistry", pct });

describe("hasPrediction", () => {
  it("withholds a grade until the subject has enough scored work", () => {
    const [one] = summariseAnalytics(["chemistry"], [quiz(0)], []);
    expect(one.predictedGrade).toBe(1);
    expect(hasPrediction(one)).toBe(false);

    const enough = Array.from({ length: MIN_WORK_FOR_PREDICTION }, () => quiz(85));
    const [row] = summariseAnalytics(["chemistry"], enough, []);
    expect(hasPrediction(row)).toBe(true);
    expect(row.predictedGrade).toBe(8);
  });

  it("counts quizzes and marked homework together", () => {
    const [row] = summariseAnalytics(
      ["chemistry"],
      [quiz(70), quiz(70)],
      [{ subject: "chemistry", pct: 70 }],
    );
    expect(row.mcqAttempts + row.hwGraded).toBe(MIN_WORK_FOR_PREDICTION);
    expect(hasPrediction(row)).toBe(true);
  });

  it("never predicts from no work at all", () => {
    const [row] = summariseAnalytics(["physics"], [], []);
    expect(hasPrediction(row)).toBe(false);
  });
});

describe("trendWeeks", () => {
  // Viewers whose clocks change on other dates than the UK's, or never.
  const zones = ["America/New_York", "Asia/Dubai", "Africa/Lagos", "Europe/London"];
  const london = (d: Date) =>
    d.toLocaleDateString("en-CA", { timeZone: "Europe/London" }) as `${string}-${string}-${string}`;

  it("gives six consecutive London Mondays, labelled on their own date, in every time zone", () => {
    const saved = process.env.TZ;
    try {
      for (const zone of zones) {
        process.env.TZ = zone;
        // Every day for a year from 1 Sept 2026, both UK clock changes inside it.
        for (let day = 0; day < 365; day++) {
          const now = new Date(Date.UTC(2026, 8, 1, 12) + day * 86_400_000);
          const weeks = trendWeeks(6, now);
          expect(weeks).toHaveLength(6);
          for (const [i, w] of weeks.entries()) {
            const monday = new Date(`${w.weekStart}T12:00:00Z`);
            expect(monday.getUTCDay()).toBe(1);
            expect(w.label).toBe(
              monday.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                timeZone: "UTC",
              }),
            );
            if (i > 0) {
              const prev = new Date(`${weeks[i - 1].weekStart}T12:00:00Z`);
              expect(monday.getTime() - prev.getTime()).toBe(7 * 86_400_000);
            }
          }
          // The last week is the one "now" falls in, by the UK calendar.
          const last = new Date(`${weeks[5].weekStart}T12:00:00Z`).getTime();
          const today = new Date(`${london(now)}T12:00:00Z`).getTime();
          expect(today - last).toBeGreaterThanOrEqual(0);
          expect(today - last).toBeLessThan(7 * 86_400_000);
        }
      }
    } finally {
      process.env.TZ = saved;
    }
  });

  it("keeps the week of 26 Oct 2026 for a viewer in New York", () => {
    const saved = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const weeks = trendWeeks(6, new Date("2026-11-04T15:00:00Z"));
      expect(weeks.map((w) => w.weekStart)).toContain("2026-10-26");
      expect(weeks.find((w) => w.weekStart === "2026-10-26")?.label).toBe("26 Oct");
    } finally {
      process.env.TZ = saved;
    }
  });
});
