import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ListChecks,
  Sparkles,
  CalendarClock,
  BookOpen,
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
  due_at: string | null;
  questionCount: number;
  attemptCount: number;
};

function useManagedSets() {
  return useQuery({
    queryKey: ["tutor-mcq-sets"],
    queryFn: async (): Promise<ManagedSet[]> => {
      const [{ data: sets, error }, { data: questions }, { data: attempts }] = await Promise.all([
        supabase
          .from("mcq_sets")
          .select("id, title, published, created_at, due_at")
          .order("created_at", { ascending: false }),
        supabase.from("mcq_questions").select("set_id"),
        supabase.from("mcq_attempts").select("set_id"),
      ]);
      if (error) throw error;

      const tally = (rows: { set_id: string }[] | null) => {
        const m = new Map<string, number>();
        for (const r of rows ?? []) m.set(r.set_id, (m.get(r.set_id) ?? 0) + 1);
        return m;
      };
      const qCounts = tally(questions);
      const aCounts = tally(attempts);

      return (sets ?? []).map((s) => ({
        ...s,
        questionCount: qCounts.get(s.id) ?? 0,
        attemptCount: aCounts.get(s.id) ?? 0,
      }));
    },
  });
}

export function McqManager() {
  const { data: sets = [], isPending, error } = useManagedSets();
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
    if (
      !window.confirm(
        `Delete "${s.title}"? This permanently removes the quiz, its ${s.questionCount} question${
          s.questionCount === 1 ? "" : "s"
        } and all ${s.attemptCount} student attempt${s.attemptCount === 1 ? "" : "s"}.`,
      )
    )
      return;
    setBusyId(s.id);
    // mcq_questions and mcq_attempts both cascade on the set FK, so one delete is enough.
    const { error } = await supabase.from("mcq_sets").delete().eq("id", s.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Quiz deleted");
    reload();
  };

  const weekly = sets.filter((s) => s.due_at);
  const topical = sets.filter((s) => !s.due_at);

  const Row = (s: ManagedSet) => (
    <div
      key={s.id}
      className="rounded-2xl bg-card border border-border p-5 flex flex-col sm:flex-row sm:items-center gap-4"
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
            {s.due_at ? (
              <>
                <CalendarClock className="w-3 h-3" />
                Due {new Date(s.due_at).toLocaleDateString()}
              </>
            ) : (
              new Date(s.created_at).toLocaleDateString()
            )}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/mcq/$setId"
          params={{ setId: s.id }}
          className="inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg border border-border hover:border-primary/50 hover:text-primary transition"
        >
          <Eye className="w-3.5 h-3.5" /> Preview
        </Link>
        <button
          onClick={() => togglePublish(s)}
          disabled={busyId === s.id}
          className="inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg border border-border hover:border-primary/50 hover:text-primary transition disabled:opacity-50"
        >
          {s.published ? "Unpublish" : "Publish"}
        </button>
        <button
          onClick={() => remove(s)}
          disabled={busyId === s.id}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border text-muted-foreground hover:border-destructive/50 hover:text-destructive transition disabled:opacity-50"
          aria-label="Delete quiz"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  const Section = ({
    icon: Icon,
    label,
    items,
  }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    items: ManagedSet[];
  }) =>
    items.length === 0 ? null : (
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-2 border-b border-border/60">
          <Icon className="w-4 h-4 text-primary" />
          <h3 className="font-display font-bold text-sm tracking-wide uppercase text-foreground">
            {label}
          </h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
            {items.length}
          </span>
        </div>
        <div className="space-y-3">{items.map(Row)}</div>
      </div>
    );

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-8">
        <p className="text-muted-foreground max-w-2xl">
          Manage every quiz you&apos;ve generated: publish or unpublish to control what students see,
          preview the student experience, and delete sets you no longer need.
        </p>
        <Link
          to="/tutor"
          className="inline-flex items-center gap-2 shrink-0 text-sm font-semibold px-4 py-2.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition"
        >
          <Wand2 className="w-4 h-4" /> Generate quiz
        </Link>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          Couldn&apos;t load quizzes: {(error as Error).message}
        </div>
      ) : isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <ListChecks className="w-8 h-8 mx-auto mb-3 opacity-50" />
          No quizzes yet. Use “Generate quiz” to create your first one.
        </div>
      ) : (
        <div className="space-y-10">
          <Section icon={CalendarClock} label="Weekly assigned quizzes" items={weekly} />
          <Section icon={BookOpen} label="Topical assessments" items={topical} />
        </div>
      )}
    </>
  );
}
