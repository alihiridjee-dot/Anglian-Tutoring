import { PLANNER_TIME_ZONE, weekKeyToDate, addWeeks, toDateKey } from "@/lib/planner/week";

export function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    timeZone: PLANNER_TIME_ZONE,
    day: "numeric",
    month: "short",
  });
}
/** Every Monday date-key from `startKey` to `endKey` inclusive. */
export function weekKeysBetween(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  let d = weekKeyToDate(startKey);
  const end = weekKeyToDate(endKey);
  while (d <= end) {
    out.push(toDateKey(d));
    d = addWeeks(d, 1);
  }
  return out;
}
