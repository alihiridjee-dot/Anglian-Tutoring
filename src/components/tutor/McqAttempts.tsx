import { Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/platform/errors";
import { EmptyState, ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { DotWord, Mark, QUIET, Tally } from "@/components/planner/workbench/figures";
import { useEntryState } from "@/hooks/useEntryState";
import { SUBJECTS, type SubjectV } from "@/lib/curriculum/taxonomy";
import { SUBJECT_TINT, subjectLabel } from "@/lib/curriculum/subjectTheme";
import { plannerDateLabel } from "@/lib/planner/week";

/**
 * Every quiz a student has taken, newest first: the tutor's MCQs counterpart
 * to the marking queue on Tasks & Marking. A quiz marks itself, so there is
 * nothing here to review: each row says who took which quiz, when, and what
 * they scored. Tutors read every attempt under RLS ("attempts read self or
 * tutor"), so this is a plain client read.
 */

/** Attempts per request. */
const PAGE = 25;

type Attempt = {
  id: string;
  userId: string;
  setId: string;
  title: string;
  subject: string | null;
  pct: number;
  takenAt: string;
};

type AttemptRow = {
  id: string;
  user_id: string;
  set_id: string;
  score: number;
  total: number;
  created_at: string;
  mcq_sets: {
    title: string;
    subject: string | null;
    spec_points: { code: string | null } | null;
  } | null;
};

/** A quiz's name with its spec code in front, as the student's own list shows it. */
function quizTitle(title: string, code: string | null | undefined): string {
  return code && !title.startsWith(code) ? `${code} ${title}` : title;
}

/**
 * One page of attempts, with the full count and the takers' names. Paged on
 * the server: one read of every attempt would stop at PostgREST's 1,000-row
 * cap once the table passes it.
 */
async function fetchAttempts(subject: SubjectV | null, offset: number) {
  let q = supabase
    .from("mcq_attempts")
    .select(
      "id, user_id, set_id, score, total, created_at, mcq_sets!inner(title, subject, spec_points(code))",
      { count: "exact" },
    );
  if (subject) q = q.eq("mcq_sets.subject", subject);
  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + PAGE - 1);
  if (error) throw dbError(error);

  const rows = (data ?? []) as unknown as AttemptRow[];
  const attempts: Attempt[] = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    setId: r.set_id,
    title: quizTitle(r.mcq_sets?.title ?? "Untitled quiz", r.mcq_sets?.spec_points?.code),
    subject: r.mcq_sets?.subject ?? null,
    pct: r.total > 0 ? (r.score / r.total) * 100 : 0,
    takenAt: r.created_at,
  }));

  const ids = [...new Set(attempts.map((a) => a.userId))];
  const names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    if (pErr) throw dbError(pErr);
    for (const p of profs ?? []) if (p.display_name) names[p.id] = p.display_name;
  }
  return { attempts, names, total: count ?? attempts.length };
}

export function McqAttempts() {
  // Kept with the visit, so Back from a quiz preview finds the same subject.
  const [subject, setSubject] = useEntryState<SubjectV | null>("mcq-attempts.subject", null);
  const list = useInfiniteQuery({
    queryKey: ["tutor-mcq-attempts", subject],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchAttempts(subject, pageParam),
    getNextPageParam: (last, pages) =>
      last.attempts.length < PAGE ? undefined : pages.length * PAGE,
    // The list stays on screen while another subject's rows land.
    placeholderData: (prev) => prev,
  });

  // An attempt that moved between pages while they were read shouldn't show twice.
  const { attempts, names } = useMemo(() => {
    const byId = new Map<string, Attempt>();
    const names: Record<string, string> = {};
    for (const page of list.data?.pages ?? []) {
      Object.assign(names, page.names);
      for (const a of page.attempts) if (!byId.has(a.id)) byId.set(a.id, a);
    }
    return { attempts: [...byId.values()], names };
  }, [list.data]);
  const total = list.data?.pages.at(-1)?.total ?? attempts.length;
  const nameOf = (id: string) => names[id] || `Student ${id.slice(0, 8)}`;

  return (
    <section className="mb-10">
      <div className="mb-4">
        <SectionHeading title="Quizzes taken">
          {total > 0 && <Tally n={total} word={total === 1 ? "attempt" : "attempts"} />}
        </SectionHeading>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[{ value: null, label: "All" }, ...SUBJECTS].map((s) => (
          <button
            key={s.value ?? "all"}
            type="button"
            aria-pressed={subject === s.value}
            onClick={() => setSubject(s.value)}
            className={`chip tap-target ${subject === s.value ? "chip-solid" : ""}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {list.error ? (
        <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Spinner label="Loading attempts" className="py-8" />
      ) : attempts.length === 0 ? (
        <div className="premium-card p-5">
          <EmptyState
            compact
            title={subject ? `No ${subjectLabel(subject)} quiz taken yet` : "No quiz taken yet"}
          />
        </div>
      ) : (
        <div className="premium-card p-2 sm:p-3">
          <ul className="divide-border divide-y">
            {attempts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-2 py-3 sm:px-3">
                <Mark value={a.pct} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{a.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold">{nameOf(a.userId)}</span>
                    {a.subject && (
                      <DotWord tint={SUBJECT_TINT[a.subject] ?? "tint-primary"}>
                        {subjectLabel(a.subject)}
                      </DotWord>
                    )}
                    <span>Taken {plannerDateLabel(new Date(a.takenAt))}</span>
                  </p>
                </div>
                <Link to="/mcq/$setId" params={{ setId: a.setId }} className={QUIET}>
                  Preview
                </Link>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <button
              type="button"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className="btn-soft mx-auto my-2 flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
            >
              {list.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
              Show more{total > attempts.length ? ` (${total - attempts.length} left)` : ""}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
