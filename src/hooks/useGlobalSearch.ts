import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useEntitlements } from "@/hooks/data/useEntitlements";
import { isDemoMode, getDemoRole } from "@/lib/auth/session";
import { runGlobalSearch, type SearchSection } from "@/lib/search/globalSearch";
import { MIN_QUERY_LENGTH } from "@/lib/search/match";
import { contentTerms, matchHelpIntent, type HelpIntentId } from "@/lib/search/help";
import { helpSection } from "@/lib/search/helpAnswers";
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
  /** True for a signed-in student: the only box that answers help requests. */
  helpOn: boolean;
  /** The help request the query was read as, if any. */
  intent: HelpIntentId | null;
}

/**
 * Help answers a student about their own week, so it's off for tutors and
 * parents, and in the showcase, which has no week to read.
 */
const helpEnabled = (ctx: SearchContext) => !ctx.isTutor && !ctx.isDemo && ctx.role === "student";

/**
 * Runs the global search for `query`, debounced and cached.
 *
 * Results are keyed by the *settled* query and the caller's scope, so
 * backspacing to a query you already ran is instant, and a tutor's results can
 * never be served from a student's cache entry.
 *
 * For a student, a query that reads as a help request ("find my mcq for this
 * week") gets its answer on top, and the content search runs on whatever words
 * are left. `forcedIntent` is the model's reading of a query the rules didn't
 * recognise, from "Ask for help".
 */
export function useGlobalSearch(
  query: string,
  forcedIntent: HelpIntentId | null = null,
): GlobalSearchState {
  const ctx = useSearchContext();
  const settled = useDebounced(query.trim());
  const active = settled.length >= MIN_QUERY_LENGTH;
  const helpOn = helpEnabled(ctx);
  const intent = helpOn && active ? (forcedIntent ?? matchHelpIntent(settled)) : null;
  const terms = useMemo(() => contentTerms(settled, intent), [settled, intent]);
  const contentQuery = terms.join(" ");
  const searching = contentQuery.length >= MIN_QUERY_LENGTH;

  const scopeKey = [
    ctx.isTutor,
    ctx.role,
    ctx.level,
    ctx.entitledSubjects.join(","),
    ctx.isDemo ? (ctx.demoRole ?? "demo") : "live",
  ].join("|");

  const { data, isFetching, error } = useQuery({
    queryKey: ["global-search", contentQuery, scopeKey],
    queryFn: () => runGlobalSearch(contentQuery, ctx),
    enabled: active && searching,
    staleTime: 30_000,
    // The previous query's results stay on screen while the next one lands, so
    // the list refines rather than blanking on every keystroke.
    placeholderData: (prev) => prev,
  });

  // Keyed by the intent, not the query: typing on past "find my mcq" doesn't
  // re-read the week for every letter.
  const help = useQuery({
    queryKey: ["global-search-help", intent, scopeKey],
    queryFn: () => helpSection(intent!, ctx),
    enabled: !!intent,
    staleTime: 60_000,
  });

  const sections = useMemo(() => {
    const found = active && searching ? (data ?? NO_SECTIONS) : NO_SECTIONS;
    return intent && help.data ? [help.data, ...found] : found;
  }, [active, searching, data, intent, help.data]);

  return {
    sections,
    terms,
    // Only report loading on a *cold* query — with placeholder data on screen a
    // spinner would just flicker.
    loading: (active && searching && isFetching && !data) || (!!intent && help.isLoading),
    active,
    error: error instanceof Error ? error.message : null,
    helpOn,
    intent,
  };
}
