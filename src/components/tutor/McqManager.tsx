import { Spinner } from "@/components/Shared";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ListChecks,
  Loader2,
  Sparkles,
  Eye,
  Trash2,
  Users,
  FileQuestion,
  Wand2,
} from "lucide-react";

// Tutor-facing counterpart to the student MCQs page. Same route (/mcqs), entirely
// different view: instead of "Take Quiz" cards this lists every set the tutor owns
// with its status, question and attempt counts, and publish/delete controls. Tutor
// RLS grants full read/write on mcq_sets + mcq_questions and read on mcq_attempts,
// so this is a pure client-side view — no dedicated server functions needed.

type ManagedSet = {
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  questionCount: number;
  attemptCount: number;
};

/** Sets per request. */
const PAGE = 50;

/**
 * The tutor's quiz sets, a page at a time, each with its question and attempt
 * counts worked out by the database. Reading every question and attempt row to
 * tally them here stopped at PostgREST's 1,000-row cap (S-17b), so past that
 * the counts were wrong, and the delete confirmation could promise "0 student
 * attempts" while deleting real ones.
 */
function useManagedSets() {
  return useInfiniteQuery({
    queryKey: ["tutor-mcq-sets"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error, count } = await supabase
        .from("mcq_sets")
        .select("id, title, published, created_at, mcq_questions(count), mcq_attempts(count)", {
          count: "exact",
        })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(pageParam, pageParam + PAGE - 1);
      if (error) throw error;

      const sets: ManagedSet[] = (data ?? []).map(({ mcq_questions, mcq_attempts, ...s }) => ({
        ...s,
        questionCount: mcq_questions[0]?.count ?? 0,
        attemptCount: mcq_attempts[0]?.count ?? 0,
      }));
      return { sets, total: count ?? sets.length };
    },
    getNextPageParam: (last, pages) => (last.sets.length < PAGE ? undefined : pages.length * PAGE),
  });
}

export function McqManager() {
  const managed = useManagedSets();
  const { isPending, error } = managed;
  // A set that moved between pages while they were read shouldn't show twice.
  const sets = useMemo(() => {
    const byId = new Map<string, ManagedSet>();
    for (const page of managed.data?.pages ?? [])
      for (const s of page.sets) if (!byId.has(s.id)) byId.set(s.id, s);
    return [...byId.values()];
  }, [managed.data]);
  const total = managed.data?.pages.at(-1)?.total ?? sets.length;
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => qc.invalidateQueries({ queryKey: ["tutor-mcq-sets"] });

  const togglePublish = async (s: ManagedSet) => {
    setBusyId(s.id);
    const { error } = await supabase
      .from("mcq_sets")
      .update({ published: !s.published })
      .eq("id", s.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(s.published ? "Unpublished — hidden from students" : "Published to students");
    reload();
  };

  const remove = async (s: ManagedSet) => {
    // Students' results would go with it, so the database refuses (S-18).
    if (s.attemptCount > 0) {
      return toast.error(
        `Students have taken this quiz (${s.attemptCount} attempt${s.attemptCount === 1 ? "" : "s"}), so it can't be deleted. To fix its questions, use "Replace questions" on its spec point.`,
      );
    }
    if (
      !window.confirm(
        `Delete "${s.title}"? This permanently removes the quiz and its ${s.questionCount} question${
          s.questionCount === 1 ? "" : "s"
        }.`,
      )
    )
      return;
    setBusyId(s.id);
    // mcq_questions cascades on the set FK, so one delete is enough. A set with
    // attempts is refused by the database even if the count above was stale.
    const { error } = await supabase.from("mcq_sets").delete().eq("id", s.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Quiz deleted");
    reload();
  };

  const Row = (s: ManagedSet) => (
    <div
      key={s.id}
      className="rounded-2xl premium-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4"
    >
      <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-display font-bold text-base leading-snug truncate">{s.title}</h4>
          <span
            className={`text-[9px] px-2 py-0.5 rounded uppercase tracking-wider font-bold ${
              s.published ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {s.published ? "Live" : "Draft"}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1">
            <FileQuestion className="w-3 h-3" />
            {s.questionCount} question{s.questionCount === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="w-3 h-3" />
            {s.attemptCount} attempt{s.attemptCount === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1">
            {new Date(s.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Link
          to="/mcq/$setId"
          params={{ setId: s.id }}
          className="inline-flex min-h-11 sm:min-h-0 items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg border border-border hover:border-primary/50 hover:text-primary transition"
        >
          <Eye className="w-3.5 h-3.5" /> Preview
        </Link>
        <button
          onClick={() => togglePublish(s)}
          disabled={busyId === s.id}
          className="inline-flex min-h-11 sm:min-h-0 items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg border border-border hover:border-primary/50 hover:text-primary transition disabled:opacity-50"
        >
          {s.published ? "Unpublish" : "Publish"}
        </button>
        <button
          onClick={() => remove(s)}
          disabled={busyId === s.id}
          className="inline-flex items-center justify-center size-11 sm:size-9 rounded-lg border border-border text-muted-foreground hover:border-destructive/50 hover:text-destructive transition disabled:opacity-50"
          aria-label="Delete quiz"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <p className="text-muted-foreground max-w-2xl">
          Manage every quiz you&apos;ve generated: publish or unpublish to control what students
          see, preview the student experience, and delete sets you no longer need.
        </p>
        <Link
          to="/curriculum"
          className="inline-flex min-h-11 sm:min-h-0 items-center gap-2 shrink-0 text-sm font-semibold px-4 py-2.5 rounded-lg btn-solid hover:opacity-90 transition"
        >
          <Wand2 className="w-4 h-4" /> Generate quiz
        </Link>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          Couldn&apos;t load quizzes: {(error as Error).message}
        </div>
      ) : isPending ? (
        <Spinner label="Loading quizzes" className="py-8" />
      ) : sets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <ListChecks className="w-8 h-8 mx-auto mb-3 opacity-50" />
          No quizzes yet. Use “Generate quiz” to create your first one.
        </div>
      ) : (
        <div className="space-y-3">
          {sets.map(Row)}
          {managed.hasNextPage && (
            <button
              type="button"
              onClick={() => void managed.fetchNextPage()}
              disabled={managed.isFetchingNextPage}
              className="btn-soft mx-auto flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
            >
              {managed.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
              Show more{total > sets.length ? ` (${total - sets.length} left)` : ""}
            </button>
          )}
        </div>
      )}
    </>
  );
}
