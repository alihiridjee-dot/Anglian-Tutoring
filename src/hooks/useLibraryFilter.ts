import { useMemo } from "react";
import { useEntryState } from "@/hooks/useEntryState";
import { useDebounced } from "@/hooks/useGlobalSearch";
import { NO_FILTER, type LibraryFilter } from "@/lib/curriculum/libraryFilter";

/**
 * The filter as typed, and as the queries should see it: the search settles
 * before it is sent, so a query isn't fired per keystroke. Kept with the visit,
 * so Back from a preview finds the list filtered as it was left.
 */
export function useLibraryFilter(name: string) {
  const [filter, setFilter] = useEntryState<LibraryFilter>(name, NO_FILTER);
  const q = useDebounced(filter.q.trim());
  const settled = useMemo(() => ({ ...filter, q }), [filter, q]);
  return [filter, setFilter, settled] as const;
}
