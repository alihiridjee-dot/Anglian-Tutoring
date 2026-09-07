/** The teaching calendar is UK time, independent of the viewer's location. */
export const PLANNER_TIME_ZONE = "Europe/London";
const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PLANNER_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function parts(d: Date): Record<string, number> {
  return Object.fromEntries(partsFormatter.formatToParts(d)
    .filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
}
export function toDateKey(d: Date): string {
  const p = parts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
/** Parse a calendar key at London midnight, including BST transitions. */
export function weekKeyToDate(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("Invalid calendar date");
  const utc = new Date(`${key}T00:00:00Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== key)
    throw new Error("Invalid calendar date");
  let time = utc.getTime();
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(time));
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const delta = utc.getTime() - wall;
    if (!delta) return new Date(time);
    time += delta;
  }
  throw new Error("Could not resolve UK calendar date");
}
function shiftDays(d: Date, days: number): Date {
  const date = new Date(`${toDateKey(d)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return weekKeyToDate(date.toISOString().slice(0, 10));
}
export function mondayOf(d: Date = new Date()): Date {
  const key = toDateKey(d);
  const dow = (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
  return shiftDays(d, -dow);
}
export const sundayOf = (monday: Date): Date => shiftDays(monday, 6);
export function addWeeks(monday: Date, n: number): Date {
  if (!Number.isInteger(n)) throw new Error("Week offsets must be whole numbers");
  return shiftDays(monday, n * 7);
}
export const currentWeekKey = (now: Date = new Date()): string => toDateKey(mondayOf(now));
export const plannerDateLabel = (d: Date, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string =>
  d.toLocaleDateString("en-GB", { ...options, timeZone: PLANNER_TIME_ZONE });
export function weekRangeLabel(monday: Date): string {
  const sunday = sundayOf(monday);
  const start = toDateKey(monday), end = toDateKey(sunday);
  const day = (s: string) => Number(s.slice(8));
  if (start.slice(0, 7) === end.slice(0, 7))
    return `${day(start)}–${day(end)} ${plannerDateLabel(sunday, { month: "short", year: "numeric" })}`;
  if (start.slice(0, 4) === end.slice(0, 4))
    return `${plannerDateLabel(monday)} – ${plannerDateLabel(sunday, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${plannerDateLabel(monday, { day: "numeric", month: "short", year: "numeric" })} – ${plannerDateLabel(sunday, { day: "numeric", month: "short", year: "numeric" })}`;
}
