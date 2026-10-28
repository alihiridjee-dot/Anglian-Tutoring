import { expect, test } from "bun:test";
import {
  addWeeks,
  currentWeekKey,
  relativeWeekLabel,
  shortDayLabel,
  weekKeyToDate,
  toDateKey,
  toUkDateTimeInput,
  ukDateTimeToDate,
} from "./week";

test("UK Monday keys do not follow the viewer's timezone", () => {
  expect(currentWeekKey(new Date("2026-09-06T23:30:00Z"))).toBe("2026-09-07");
  expect(currentWeekKey(new Date("2026-09-06T22:59:00Z"))).toBe("2026-08-31");
  for (const TZ of ["UTC", "America/New_York", "Asia/Tokyo"]) {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `import {currentWeekKey,weekKeyToDate} from './src/lib/planner/week.ts'; console.log(currentWeekKey(new Date('2026-09-06T23:30:00Z')),weekKeyToDate('2026-09-07').toISOString())`,
      ],
      { env: { ...process.env, TZ } },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("2026-09-07 2026-09-06T23:00:00.000Z");
  }
});
test("calendar weeks retain midnight through both BST transitions", () => {
  for (const [key, hours] of [
    ["2026-03-23", 167],
    ["2026-10-19", 169],
  ] as const) {
    const start = weekKeyToDate(key),
      next = addWeeks(start, 1);
    expect((next.getTime() - start.getTime()) / 3600000).toBe(hours);
    expect(weekKeyToDate(toDateKey(next))).toEqual(next);
  }
});
test("invalid date keys fail rather than rolling into another month", () => {
  for (const key of ["2026-02-30", "2026-13-01", "garbage"])
    expect(() => weekKeyToDate(key)).toThrow();
});
test("relative week labels count whole weeks, across a clock change", () => {
  expect(relativeWeekLabel("2026-09-21", "2026-09-21")).toBe("This week");
  expect(relativeWeekLabel("2026-09-28", "2026-09-21")).toBe("Next week");
  expect(relativeWeekLabel("2026-09-14", "2026-09-21")).toBe("Last week");
  // BST ends on 25 Oct 2026, between these two Mondays.
  expect(relativeWeekLabel("2026-11-02", "2026-10-19")).toBe("In 2 weeks");
  expect(relativeWeekLabel("2026-08-31", "2026-09-21")).toBe("3 weeks ago");
});
test("a typed lesson or due time is UK time, whatever zone the tutor's device is in", () => {
  // 16:00 typed from Madagascar (UTC+3) was saved as 13:00 UK.
  const cases = [
    ["2026-10-24T16:00", "2026-10-24T15:00:00.000Z"], // BST, the day before the change
    ["2026-10-29T16:00", "2026-10-29T16:00:00.000Z"], // GMT, after it
    ["2026-10-25T00:30", "2026-10-24T23:30:00.000Z"],
    ["2026-10-25T01:30", "2026-10-25T00:30:00.000Z"], // repeated hour: the first, BST, one
    ["2026-10-25T02:00", "2026-10-25T02:00:00.000Z"],
    ["2026-03-29T00:30", "2026-03-29T00:30:00.000Z"],
    ["2026-03-29T01:30", "2026-03-29T01:30:00.000Z"], // skipped hour: shown as 02:30 BST
    ["2026-03-29T02:30", "2026-03-29T01:30:00.000Z"],
  ] as const;
  const typed = JSON.stringify(cases.map(([t]) => t));
  const script = `import {ukDateTimeToDate,toUkDateTimeInput} from './src/lib/planner/week.ts'; console.log(JSON.stringify(${typed}.map((v) => { const d = ukDateTimeToDate(v); return [d.toISOString(), toUkDateTimeInput(d)]; })))`;
  for (const TZ of ["Indian/Antananarivo", "Europe/London", "America/New_York", "UTC"]) {
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      env: { ...process.env, TZ },
    });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout.toString()) as [string, string][];
    cases.forEach(([t, iso], i) => {
      expect(out[i][0]).toBe(iso);
      // Shown back as typed, except the hour the clocks skip.
      expect(out[i][1]).toBe(t === "2026-03-29T01:30" ? "2026-03-29T02:30" : t);
    });
  }
});
test("a typed date and time that is not a real one fails rather than rolling over", () => {
  for (const v of ["", "2026-02-30T10:00", "2026-10-29T24:00", "2026-10-29 16:00", "garbage"])
    expect(() => ukDateTimeToDate(v)).toThrow();
  expect(ukDateTimeToDate("2026-10-29T16:00:30").toISOString()).toBe("2026-10-29T16:00:30.000Z");
});

test("a short day label reads the same whatever literal the browser puts after the weekday", () => {
  // Late on Tue 3 Nov in London is already Wednesday in Madagascar.
  const at = new Date("2026-11-03T23:17:00Z");
  expect(shortDayLabel(at, "Europe/London")).toBe("Tue 3 Nov");
  expect(shortDayLabel(at, "Indian/Antananarivo")).toBe("Wed 4 Nov");
  const real = Intl.DateTimeFormat.prototype.formatToParts;
  Intl.DateTimeFormat.prototype.formatToParts = function (d) {
    return real
      .call(this, d)
      .map((p) => (p.type === "literal" && p.value === " " ? { ...p, value: ", " } : p));
  };
  try {
    expect(shortDayLabel(at, "Europe/London")).toBe("Tue 3 Nov");
  } finally {
    Intl.DateTimeFormat.prototype.formatToParts = real;
  }
});
