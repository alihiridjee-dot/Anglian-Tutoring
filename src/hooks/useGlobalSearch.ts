import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useEntitlements } from "@/lib/entitlements";
import { isDemoMode, getDemoRole } from "@/lib/auth/session";
import { runGlobalSearch, type SearchSection } from "@/lib/search/globalSearch";
import { MIN_QUERY_LENGTH, queryTerms } from "@/lib/search/match";
import type { SearchContext } from "@/lib/search/types";

/** Long enough that typing a word doesn't fire five queries, short enough to feel live. */
const DEBOUNCE_MS = 180;

/** A shared empty result, so "no results" keeps a stable identity across renders. */
const NO_SECTIONS: SearchSection[] = [];

/** Debounces a value, so a query only leaves the browser once typing settles. */
export function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

/** Who is asking — resolved once here so the palette itself stays presentational. */
export function useSearchContext(): SearchContext {
  const { isTutor } = useRoles();
  const { role, level } = useEnrolments();
  const { entitledSubjects, boardBySubject } = useEntitlements();
  const isDemo = isDemoMode();
  const demoRole = getDemoRole();

  return useMemo(
    () => ({ isTutor, role, entitledSubjects, boardBySubject, level, isDemo, demoRole }),
    [isTutor, role, entitledSubjects, boardBySubject, level, isDemo, demoRole],
  );
}

export interface GlobalSearchState {
  sections: SearchSection[];
  /** The terms the results matched on — for highlighting them in the list. */
  terms: string[];
  loading: boolean;
  /** True once the query is long enough to have been run at all. */
  active: boolean;
  error: string | null;
}

/**
 * Runs the global search for `query`, debounced and cached.
 *
 * Results are keyed by the *settled* query and the caller's scope, so
 * backspacing to a query you already ran is instant, and a tutor's results can
 * never be served from a student's cache entry.
 */
export function useGlobalSearch(query: string): GlobalSearchState {
  const ctx = useSearchContext();
  const settled = useDebounced(query.trim());
  const active = settled.length >= MIN_QUERY_LENGTH;

  const scopeKey = [
    ctx.isTutor,
    ctx.role,
    ctx.level,
    ctx.entitledSubjects.join(","),
    ctx.isDemo ? (ctx.demoRole ?? "demo") : "live",
  ].join("|");

  const { data, isFetching, error } = useQuery({
    queryKey: ["global-search", settled, scopeKey],
    queryFn: () => runGlobalSearch(settled, ctx),
    enabled: active,
    staleTime: 30_000,
    // The previous query's results stay on screen while the next one lands, so
    // the list refines rather than blanking on every keystroke.
    placeholderData: (prev) => prev,
  });

  return {
    sections: active ? (data ?? NO_SECTIONS) : NO_SECTIONS,
    terms: useMemo(() => queryTerms(settled), [settled]),
    // Only report loading on a *cold* query — with placeholder data on screen a
    // spinner would just flicker.
    loading: active && isFetching && !data,
    active,
    error: error instanceof Error ? error.message : null,
  };
}
