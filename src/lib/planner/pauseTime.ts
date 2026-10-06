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
 *
 * Stops can overlap — a break booked while a payment had also lapsed — and
 * time stopped twice over is still only stopped once.
 */
export function pausedMsSince(
  spans: readonly PauseSpan[],
  since: Date | null | undefined,
  now: Date,
): number {
  if (!since) return 0;
  const clipped = spans
    .map((s) => ({
      from: Math.max(s.start.getTime(), since.getTime()),
      to: Math.min((s.end ?? now).getTime(), now.getTime()),
    }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  let ms = 0;
  let reached = -Infinity;
  for (const s of clipped) {
    const from = Math.max(s.from, reached);
    if (s.to > from) ms += s.to - from;
    reached = Math.max(reached, s.to);
  }
  return ms;
}
