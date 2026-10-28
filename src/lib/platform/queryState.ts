import type { FetchStatus } from "@tanstack/react-query";

/**
 * A read with nothing to show yet that is still going to answer: under way,
 * or offline and waiting for the network to come back.
 *
 * `isLoading` is only the first of those. Offline a read pauses with
 * `isLoading` false and no data, and a page took that for an empty answer (a
 * week with no plan). Bare `isPending` is no better for a query that is
 * switched off, which stays pending for good.
 */
export function stillReading(query: { isPending: boolean; fetchStatus: FetchStatus }): boolean {
  return query.isPending && query.fetchStatus !== "idle";
}
