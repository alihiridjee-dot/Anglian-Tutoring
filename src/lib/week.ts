// Week helpers for the "This Week" widget. Weeks run Monday → Sunday. A weekly
// plan is keyed by the date of its Monday, so the current plan is whatever row
// carries this week's Monday. When the week rolls over on Sunday night the
// Monday key changes, so last week's plan is no longer "this week" — the view
// clears itself and the tutor is prompted to set the new one. No stored state
// is ever mutated on a schedule; everything derives from today's date.

/** Local-midnight Monday that starts the week containing `d`. */
export function mondayOf(d: Date = new Date()): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay(): 0=Sun … 6=Sat. Shift so Monday is the start of the week.
  const dow = (date.getDay() + 6) % 7; // 0=Mon … 6=Sun
  date.setDate(date.getDate() - dow);
  return date;
}

/** Sunday that ends the week starting on `monday`. */
export function sundayOf(monday: Date): Date {
  const d = new Date(monday);
  d.setDate(d.getDate() + 6);
  return d;
}

/** `YYYY-MM-DD` in local time — the storage key for a week (`weekly_focus.week_start`). */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The current week's Monday as a `YYYY-MM-DD` key. */
export function currentWeekKey(now: Date = new Date()): string {
  return toDateKey(mondayOf(now));
}

/** Parse a `YYYY-MM-DD` week key back into a local-midnight Date. */
export function weekKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Human label for a week, e.g. "14–20 Jul 2026" or, across a month/year
 * boundary, "28 Jul – 3 Aug 2026". Written so students can see at a glance
 * exactly which dates the plan covers.
 */
export function weekRangeLabel(monday: Date): string {
  const sunday = sundayOf(monday);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const sameYear = monday.getFullYear() === sunday.getFullYear();
  const day = (d: Date) => d.getDate();
  const mon = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  const yr = (d: Date) => d.getFullYear();

  if (sameMonth && sameYear) {
    return `${day(monday)}–${day(sunday)} ${mon(sunday)} ${yr(sunday)}`;
  }
  if (sameYear) {
    return `${day(monday)} ${mon(monday)} – ${day(sunday)} ${mon(sunday)} ${yr(sunday)}`;
  }
  return `${day(monday)} ${mon(monday)} ${yr(monday)} – ${day(sunday)} ${mon(sunday)} ${yr(sunday)}`;
}
