/** One stop of a subject as a span of time. `end` null = still stopped. */
export interface PauseSpan {
  start: Date;
  end: Date | null;
}

/**
 * How much of the time since `since` a subject spent stopped, in ms.
 *
 * While a subject is paused nothing falls due, so a review's clock is pushed
 * back by the paused time after it was last done, and paused weeks never pile
 * up as overdue reviews. A review done after the pause is untouched.
 */
export function pausedMsSince(
  spans: readonly PauseSpan[],
  since: Date | null | undefined,
  now: Date,
): number {
  if (!since) return 0;
  let ms = 0;
  for (const s of spans) {
    const from = Math.max(s.start.getTime(), since.getTime());
    const to = Math.min((s.end ?? now).getTime(), now.getTime());
    if (to > from) ms += to - from;
  }
  return ms;
}
