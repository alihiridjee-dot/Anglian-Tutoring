import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { ListChecks, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mcqs")({
  head: () => ({ meta: [{ title: "MCQs | Anglian Tutoring" }] }),
  component: MCQs,
});

type SetRow = { id: string; title: string; published: boolean; created_at: string };

function MCQs() {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("mcq_sets")
        .select("id, title, published, created_at")
        .order("created_at", { ascending: false });
      setSets(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <AppLayout title="Weekly MCQs">
      <p className="text-muted-foreground mb-6 max-w-2xl">
        Multiple-choice quizzes for every topic. Click a set to take the quiz — you'll get instant
        feedback and explanations.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <ListChecks className="w-8 h-8 mx-auto mb-3 opacity-50" />
          No quizzes yet. Ask your tutor to generate one for this week.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sets.map((s) => (
            <Link
              key={s.id}
              to="/mcq/$setId"
              params={{ setId: s.id }}
              className="rounded-2xl bg-card border border-border p-6 hover:border-primary/50 transition group"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold ${s.published ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"}`}
                >
                  {s.published ? "Live" : "Draft"}
                </span>
              </div>
              <p className="font-display font-semibold text-lg group-hover:text-primary">
                {s.title}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {new Date(s.created_at).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
