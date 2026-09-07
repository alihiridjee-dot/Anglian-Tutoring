import { expect, test } from "bun:test";
import { addWeeks, currentWeekKey, weekKeyToDate, toDateKey } from "./week";

test("UK Monday keys do not follow the viewer's timezone", () => {
  expect(currentWeekKey(new Date("2026-09-06T23:30:00Z"))).toBe("2026-09-07");
  expect(currentWeekKey(new Date("2026-09-06T22:59:00Z"))).toBe("2026-08-31");
  for (const TZ of ["UTC", "America/New_York", "Asia/Tokyo"]) {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `import {currentWeekKey,weekKeyToDate} from './src/lib/week.ts'; console.log(currentWeekKey(new Date('2026-09-06T23:30:00Z')),weekKeyToDate('2026-09-07').toISOString())`,
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
