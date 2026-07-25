import { createFileRoute, Link } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/routeGuards";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  ListChecks,
  Sparkles,
  ChevronRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { isDemoStudent, DEMO_MCQ_SETS } from "@/lib/demo/studentDemo";
import { useRoles } from "@/hooks/useRole";
import { McqManager } from "@/components/tutor/McqManager";

export const Route = createFileRoute("/_authenticated/mcqs")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "MCQs | Anglian Learning" }] }),
  component: MCQs,
});

type SetRow = {
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  due_at?: string | null;
  board?: string;
  level?: string;
  subject?: string;
  topic?: string;
  specPoint?: string;
};

// An assigned weekly set collapses out of the banner into the completed list one
// week after its due date, regardless of whether the student finished it.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function MCQs() {
  const { isTutor, loading: rolesLoading } = useRoles();

  // Same route, different view: a tutor gets a management console (publish,
  // preview, delete), a student gets the take-a-quiz experience below. Mirrors
  // how Homework & Grades branches its page on role.
  if (rolesLoading) {
    return (
      <AppLayout title="Weekly MCQs">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppLayout>
    );
  }
  if (isTutor) {
    return (
      <AppLayout title="Weekly MCQs">
        <McqManager />
      </AppLayout>
    );
  }
  return <StudentMCQs />;
}

function StudentMCQs() {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (isDemoStudent()) {
        setSets(DEMO_MCQ_SETS);
        setLoading(false);
        return;
      }
      const [{ data }, { data: auth }] = await Promise.all([
        supabase
          .from("mcq_sets")
          .select("id, title, published, created_at, due_at")
          .order("created_at", { ascending: false }),
        supabase.auth.getUser(),
      ]);
      setSets(data ?? []);

      // Which of these sets the student has already attempted — drives the
      // "Completed" badge (visibility itself is time-driven, not completion-driven).
      const uid = auth?.user?.id;
      if (uid) {
        const { data: attempts } = await supabase
          .from("mcq_attempts")
          .select("set_id")
          .eq("user_id", uid);
        setCompletedIds(new Set((attempts ?? []).map((a: { set_id: string }) => a.set_id)));
      }
      setLoading(false);
    })();
  }, []);

  // Assigned weekly sets carry a due date; split them by the week-after-due cutoff.
  const { activeWeekly, pastWeekly, topical } = useMemo(() => {
    const now = Date.now();
    const activeWeekly: SetRow[] = [];
    const pastWeekly: SetRow[] = [];
    const topical: SetRow[] = [];
    for (const s of sets) {
      if (s.due_at) {
        const cutoff = new Date(s.due_at).getTime() + WEEK_MS;
        if (now < cutoff) activeWeekly.push(s);
        else pastWeekly.push(s);
      } else {
        topical.push(s);
      }
    }
    // Soonest due first in the banner; most-recently due first in the archive.
    activeWeekly.sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
    pastWeekly.sort((a, b) => new Date(b.due_at!).getTime() - new Date(a.due_at!).getTime());
    return { activeWeekly, pastWeekly, topical };
  }, [sets]);

  // Group the non-assigned topical assessments by Exam Board, Level, and Subject.
  const groupedAssessments = useMemo(() => {
    const groups: Record<string, SetRow[]> = {};
    for (const s of topical) {
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
  }, [topical]);

  // Shared quiz card, used by the weekly banner, the completed dropdown and the
  // topical grouping so styling stays consistent.
  const Card = (s: SetRow) => {
    const done = completedIds.has(s.id);
    return (
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
            {done ? (
              <span className="text-[9px] px-2 py-0.5 rounded uppercase tracking-wider font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Completed
              </span>
            ) : (
              <span
                className={`text-[9px] px-2 py-0.5 rounded uppercase tracking-wider font-bold ${s.published ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {s.published ? "Live" : "Draft"}
              </span>
            )}
          </div>

          {s.topic && s.specPoint && (
            <div className="space-y-1 mb-2">
              <p className="text-[10px] font-bold text-primary uppercase tracking-widest">
                {s.topic}
              </p>
              <p className="text-[10px] text-muted-foreground line-clamp-1">Spec: {s.specPoint}</p>
            </div>
          )}

          <h4 className="font-display font-bold text-base leading-snug group-hover:text-primary transition">
            {s.title}
          </h4>
        </div>

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/40 text-[11px] text-muted-foreground">
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
          <span className="flex items-center gap-1 text-primary font-medium group-hover:translate-x-1 transition duration-200">
            {done ? "Review" : "Take Quiz"} <ChevronRight className="w-3 h-3" />
          </span>
        </div>
      </Link>
    );
  };

  const hasAny = activeWeekly.length + pastWeekly.length + topical.length > 0;

  return (
    <AppLayout title="Weekly MCQs">
      <p className="text-muted-foreground mb-8 max-w-2xl">
        Structured multiple-choice quizzes organized by exam board and curriculum specification
        point. Select a quiz to receive instant detailed feedback and step-by-step model
        explanations.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !hasAny ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <ListChecks className="w-8 h-8 mx-auto mb-3 opacity-50" />
          No quizzes yet. Ask your tutor to generate one for this week.
        </div>
      ) : (
        <div className="space-y-10">
          {/* This week's MCQs — tutor-assigned sets within a week of their due date */}
          {activeWeekly.length > 0 && (
            <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-5 space-y-4">
              <div className="flex items-center gap-3">
                <CalendarClock className="w-4 h-4 text-primary" />
                <h3 className="font-display font-bold text-sm tracking-wide uppercase text-foreground">
                  This week&apos;s MCQs
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                  {activeWeekly.length} to do
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeWeekly.map((s) => Card(s))}
              </div>
            </div>
          )}

          {/* Syllabus topical assessments, grouped by board/level/subject */}
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
                {items.map((s) => Card(s))}
              </div>
            </div>
          ))}

          {/* Completed / past weekly MCQs — collapsed to keep the page tidy. Still
              reachable any time by browsing the covered spec points on Curriculum. */}
          {pastWeekly.length > 0 && (
            <details className="group rounded-2xl border border-border bg-card/50">
              <summary className="flex items-center gap-3 px-5 py-4 cursor-pointer list-none select-none">
                <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180" />
                <span className="font-display font-bold text-sm tracking-wide uppercase text-muted-foreground">
                  Completed / past MCQs
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">
                  {pastWeekly.length}
                </span>
              </summary>
              <div className="px-5 pb-5 pt-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pastWeekly.map((s) => Card(s))}
              </div>
            </details>
          )}
        </div>
      )}
    </AppLayout>
  );
}
