/** The teaching calendar is UK time, independent of the viewer's location. */
export const PLANNER_TIME_ZONE = "Europe/London";
const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PLANNER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function parts(d: Date): Record<string, number> {
  return Object.fromEntries(
    partsFormatter
      .formatToParts(d)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
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
const DAY_HALF_MS = 12 * 3_600_000;
/** UK wall-clock time minus UTC at instant `t`, in ms (0 in GMT, an hour in BST). */
function ukOffsetAt(t: number): number {
  const p = parts(new Date(t));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
}
/**
 * A typed `YYYY-MM-DDTHH:mm` (what a datetime-local input holds) read as UK
 * time, whatever zone the typing device is in: lessons and deadlines run on
 * UK time, and a tutor abroad booked 16:00 as their own 16:00. A time the
 * clocks skip (01:30 on the March change) moves on an hour; one they repeat
 * (01:30 on the October change) is the first, BST, one.
 */
export function ukDateTimeToDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) throw new Error("Invalid date and time");
  const [y, mo, d, h, mi, s] = m.slice(1).map((n) => Number(n ?? 0));
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (new Date(wall).toISOString().slice(0, 16) !== value.slice(0, 16))
    throw new Error("Invalid date and time");
  const before = wall - ukOffsetAt(wall - DAY_HALF_MS),
    after = wall - ukOffsetAt(wall + DAY_HALF_MS);
  const fits = [before, after].filter((t) => t + ukOffsetAt(t) === wall);
  return new Date(fits.length ? Math.min(...fits) : before);
}
/** `d` as the `YYYY-MM-DDTHH:mm` a datetime-local input shows, in UK time. */
export function toUkDateTimeInput(d: Date): string {
  const p = parts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
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
export const plannerDateLabel = (
  d: Date,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string => d.toLocaleDateString("en-GB", { ...options, timeZone: PLANNER_TIME_ZONE });
/**
 * "Tue 3 Nov", in `timeZone` (the viewer's own when left out). Put together
 * from its parts because browsers disagree on the literal between weekday and
 * day: some give "Tue 3 Nov", others "Tue, 3 Nov".
 */
export function shortDayLabel(d: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}
/** One week, or a run of weeks from `monday` to the Sunday after `lastMonday`. */
export function weekRangeLabel(monday: Date, lastMonday: Date = monday): string {
  const sunday = sundayOf(lastMonday);
  const start = toDateKey(monday),
    end = toDateKey(sunday);
  const day = (s: string) => Number(s.slice(8));
  if (start.slice(0, 7) === end.slice(0, 7))
    return `${day(start)}–${day(end)} ${plannerDateLabel(sunday, { month: "short", year: "numeric" })}`;
  if (start.slice(0, 4) === end.slice(0, 4))
    return `${plannerDateLabel(monday)} – ${plannerDateLabel(sunday, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${plannerDateLabel(monday, { day: "numeric", month: "short", year: "numeric" })} – ${plannerDateLabel(sunday, { day: "numeric", month: "short", year: "numeric" })}`;
}
/**
 * Where a week sits from this one, in words: "This week", "Next week",
 * "3 weeks ago". Counted on the calendar keys, so a clock change between the
 * two Mondays cannot turn a whole week into a fraction.
 */
export function relativeWeekLabel(weekKey: string, currentKey: string): string {
  const utc = (key: string) => new Date(`${key}T00:00:00Z`).getTime();
  const n = Math.round((utc(weekKey) - utc(currentKey)) / (7 * 86_400_000));
  if (n === 0) return "This week";
  if (n === 1) return "Next week";
  if (n === -1) return "Last week";
  return n > 0 ? `In ${n} weeks` : `${-n} weeks ago`;
}
