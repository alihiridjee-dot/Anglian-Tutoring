import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StepCard } from "@/components/onboarding/StepCard";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { PlannerDAL, type TopicWithConfidence } from "@/lib/plannerDal";
import { BANDS, bandOf, type BandKey } from "@/lib/planner/bands";
import { type SubjectV, type BoardV } from "@/lib/taxonomy";

/**
 * Step 4 — a light first pass at the planner.
 *
 * The full drag-and-drop board lives at /planner; here we just want a quick
 * confidence read on each topic group so the student's very first weekly plan
 * has something to reason about. One tap per topic, fully skippable, and every
 * value is editable later from the planner. By this step the student already
 * has a level, board and subjects, so the curriculum tree is available.
 */
export const Route = createFileRoute("/onboarding/confidence")({
  head: () => ({ meta: [{ title: "Your topics | Anglian Learning" }] }),
  component: ConfidenceStep,
});

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

function ConfidenceStep() {
  const navigate = useNavigate();
  const { enrolments, level, loading } = useEnrolments();
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setStudentId(data.user?.id ?? null));
  }, []);

  // Biology first, then any other subjects the student takes.
  const ordered = [
    ...enrolments.filter((e) => e.subject === "biology"),
    ...enrolments.filter((e) => e.subject !== "biology"),
  ];

  return (
    <StepCard
      title="How do you feel about each topic?"
      subtitle="Tap where you're at — a rough gut feel is perfect. We'll use it to build your first weekly plan, and you can re-sort any time in your planner."
      onBack={() => navigate({ to: "/onboarding/learning" })}
      onSkip={() => navigate({ to: "/onboarding/school" })}
      onContinue={() => navigate({ to: "/onboarding/school" })}
      continueLabel="Continue"
    >
      {loading || !studentId || !level ? (
        <div className="py-10 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No subjects yet — you can set your confidence later from the planner.
        </p>
      ) : (
        <div className="space-y-6">
          {ordered.map((e) => (
            <SubjectConfidence
              key={e.subject}
              studentId={studentId}
              subject={e.subject as SubjectV}
              board={e.board as BoardV}
              level={level}
              showHeader={ordered.length > 1}
            />
          ))}
        </div>
      )}
    </StepCard>
  );
}

function SubjectConfidence({
  studentId,
  subject,
  board,
  level,
  showHeader,
}: {
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: "gcse" | "alevel";
  showHeader: boolean;
}) {
  const [topics, setTopics] = useState<TopicWithConfidence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    PlannerDAL.getTopicsWithConfidence(studentId, level, board, subject)
      .then((t) => alive && setTopics(t))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [studentId, level, board, subject]);

  const rate = (topicId: string, key: BandKey) => {
    const midpoint = BANDS.find((b) => b.key === key)!.midpoint;
    setTopics((prev) => prev.map((t) => (t.id === topicId ? { ...t, confidence: midpoint } : t)));
    PlannerDAL.setTopicConfidence(topicId, midpoint).catch((err) =>
      console.error("set topic confidence", err),
    );
  };

  if (loading) {
    return (
      <div className="py-6 text-center">
        <Loader2 className="w-4 h-4 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }
  if (topics.length === 0) return null;

  return (
    <div>
      {showHeader && (
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
          {subjectLabel[subject] ?? subject}
        </h3>
      )}
      <div className="space-y-2">
        {topics.map((t) => {
          const activeKey = t.confidence != null ? bandOf(t.confidence).key : null;
          return (
            <div
              key={t.id}
              className="rounded-xl border border-border bg-muted/30 p-3 flex flex-col sm:flex-row sm:items-center gap-2.5"
            >
              <div className="flex-1 min-w-0 text-sm font-medium">{t.title}</div>
              <div className="flex gap-1.5 shrink-0">
                {BANDS.map((b) => {
                  const active = activeKey === b.key;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => rate(t.id, b.key)}
                      className={`h-8 px-2.5 rounded-lg text-xs font-semibold border transition ${
                        active
                          ? "text-white border-transparent " + b.dot
                          : "bg-card border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
