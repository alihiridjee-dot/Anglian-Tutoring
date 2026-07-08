import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { ListChecks, Sparkles, ChevronRight, BookOpen } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mcqs")({
  head: () => ({ meta: [{ title: "MCQs | Anglian Learning" }] }),
  component: MCQs,
});

type SetRow = {
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  board?: string;
  level?: string;
  subject?: string;
  topic?: string;
  specPoint?: string;
};

function MCQs() {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const isDemo =
      typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
    if (isDemo) {
      setSets([
        {
          id: "mcq-photosynthesis-chloroplasts",
          title: "Photosynthesis & Chloroplasts Mastery",
          published: true,
          created_at: "2026-07-02T10:00:00Z",
          board: "aqa",
          level: "gcse",
          subject: "biology",
          topic: "Bioenergetics",
          specPoint: "4.4.1.1 Photosynthesis & Limiting Factors",
        },
        {
          id: "mcq-chemistry-electrolysis",
          title: "Electrolysis and Ionic Equations Assessment",
          published: true,
          created_at: "2026-07-01T12:00:00Z",
          board: "edexcel",
          level: "gcse",
          subject: "chemistry",
          topic: "Electrolysis & Aqueous Solutions",
          specPoint: "C4.1 Half-Equations & Electrode Reactions",
        },
        {
          id: "mcq-physics-nuclear",
          title: "Nuclear Fission, Fusion & Radioactive Decay Test",
          published: true,
          created_at: "2026-06-29T14:00:00Z",
          board: "ocr",
          level: "gcse",
          subject: "physics",
          topic: "Nuclear Physics & Radioactivity",
          specPoint: "P6.1 Radioactive Decay Modes",
        },
      ]);
      setLoading(false);
      return;
    }

    (async () => {
      const { data } = await supabase
        .from("mcq_sets")
        .select("id, title, published, created_at")
        .order("created_at", { ascending: false });
      setSets(data ?? []);
      setLoading(false);
    })();
  }, []);

  // Group assessments by Exam Board, Level, and Subject
  const groupedAssessments = useMemo(() => {
    const groups: Record<string, SetRow[]> = {};
    for (const s of sets) {
      const boardLabel = s.board ? s.board.toUpperCase() : "";
      const levelLabel = s.level ? (s.level === "alevel" ? "A-Level" : "GCSE") : "";
      const subjectLabel = s.subject ? s.subject.charAt(0).toUpperCase() + s.subject.slice(1) : "";

      const catKey =
        boardLabel && levelLabel && subjectLabel
          ? `${boardLabel} • ${levelLabel} ${subjectLabel}`
          : "Syllabus Topical Assessments";

      if (!groups[catKey]) {
        groups[catKey] = [];
      }
      groups[catKey].push(s);
    }
    return groups;
  }, [sets]);

  return (
    <AppLayout title="Weekly MCQs">
      <p className="text-muted-foreground mb-8 max-w-2xl">
        Structured multiple-choice quizzes organized by exam board and curriculum specification
        point. Select a quiz to receive instant detailed feedback and step-by-step model
        explanations.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <ListChecks className="w-8 h-8 mx-auto mb-3 opacity-50" />
          No quizzes yet. Ask your tutor to generate one for this week.
        </div>
      ) : (
        <div className="space-y-10">
          {Object.entries(groupedAssessments).map(([category, items]) => (
            <div key={category} className="space-y-4">
              <div className="flex items-center gap-3 pb-2 border-b border-border/60">
                <BookOpen className="w-4 h-4 text-primary" />
                <h3 className="font-display font-bold text-sm tracking-wide uppercase text-foreground">
                  {category}
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                  {items.length} quiz{items.length === 1 ? "" : "zes"}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((s) => (
                  <Link
                    key={s.id}
                    to="/mcq/$setId"
                    params={{ setId: s.id }}
                    className="rounded-2xl bg-card border border-border p-6 hover:border-primary/50 transition group flex flex-col justify-between relative overflow-hidden"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-4">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                          <Sparkles className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded uppercase tracking-wider font-bold ${s.published ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
                        >
                          {s.published ? "Live" : "Draft"}
                        </span>
                      </div>

                      {/* Section details */}
                      {s.topic && s.specPoint && (
                        <div className="space-y-1 mb-2">
                          <p className="text-[10px] font-bold text-primary uppercase tracking-widest">
                            {s.topic}
                          </p>
                          <p className="text-[10px] text-muted-foreground line-clamp-1">
                            Spec: {s.specPoint}
                          </p>
                        </div>
                      )}

                      <h4 className="font-display font-bold text-base leading-snug group-hover:text-primary transition">
                        {s.title}
                      </h4>
                    </div>

                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/40 text-[11px] text-muted-foreground">
                      <span>{new Date(s.created_at).toLocaleDateString()}</span>
                      <span className="flex items-center gap-1 text-primary font-medium group-hover:translate-x-1 transition duration-200">
                        Take Quiz <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
