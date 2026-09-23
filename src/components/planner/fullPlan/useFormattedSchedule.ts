import { useMemo, useState } from "react";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { currentWeekKey } from "@/lib/planner/week";
import { foldMonths, formatSchedule } from "./formatSchedule";

/** The current month and the two after it; the rest waits behind one button. */
const UPCOMING_MONTHS = 3;

/**
 * The full plan, formatted, with the two view choices the tutor can make on it:
 * unfold the weeks before this one, and show the rest of the year.
 *
 * All the reading of bands, backlog and catch-up happens in
 * {@link formatSchedule}; this only remembers the choices and keeps the result
 * stable between renders, so opening one line does not re-derive forty weeks.
 * Mount it under a key per student and subject — a new course starts folded.
 */
export function useFormattedSchedule(data: RoadmapResult | null) {
  const [showHistory, setShowHistory] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const now = currentWeekKey();

  const schedule = useMemo(
    () => (data ? formatSchedule(data, { now, showHistory }) : null),
    [data, now, showHistory],
  );
  const folded = useMemo(
    () =>
      schedule
        ? showAll
          ? { visible: schedule.months, hiddenWeeks: 0 }
          : foldMonths(schedule.months, UPCOMING_MONTHS)
        : { visible: [], hiddenWeeks: 0 },
    [schedule, showAll],
  );

  return {
    schedule,
    months: folded.visible,
    hiddenWeeks: folded.hiddenWeeks,
    showHistory,
    toggleHistory: () => setShowHistory((v) => !v),
    showRest: () => setShowAll(true),
  };
}
