import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { ClipboardList, Upload, FileText, X, CheckCircle2, Clock, Info, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { SignedFileLink } from "@/components/SignedFileLink";
import { isDemoStudent, DEMO_HOMEWORK, DEMO_SUBMISSIONS } from "@/lib/demo/studentDemo";

export const Route = createFileRoute("/_authenticated/homework")({
  head: () => ({ meta: [{ title: "Homework & Grades | Anglian Learning" }] }),
  component: HomeworkPage,
});

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};
const subjectColor: Record<string, string> = {
  biology: "from-accent to-accent/60",
  chemistry: "from-primary to-primary/60",
  physics: "from-primary-deep to-primary",
};

type Homework = {
  id: string;
  title: string;
  instructions: string | null;
  subject: string;
  due_at: string | null;
  created_at: string;
};
type SubmissionRow = {
  id: string;
  resource_id: string;
  student_id: string;
  files: Array<{ path: string; name: string }>;
  notes: string | null;
  submitted_at: string;
  grade: string | null;
  score_pct: number | null;
  feedback: string | null;
  graded_at: string | null;
};

function HomeworkPage() {
  const { isTutor, userId } = useRoles();
  const demo = isDemoStudent();
  const { enrolledCourses } = useEnrolments();
  const [homework, setHomework] = useState<Homework[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionRow>>({});
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    // Demo student: render the self-contained fixture set, never real content.
    if (isDemoStudent()) {
      setHomework(DEMO_HOMEWORK);
      setSubmissions(DEMO_SUBMISSIONS);
      setLoading(false);
      return;
    }
    let q = supabase
      .from("resources")
      .select("id, title, instructions, subject, due_at, created_at")
      .eq("kind", "homework")
      .order("due_at", { ascending: true });
    if (!isTutor && enrolledCourses.length > 0)
      q = q.in("subject", enrolledCourses as ("biology" | "chemistry" | "physics")[]);
    const { data: hw } = await q;
    setHomework((hw ?? []) as Homework[]);

    if (userId) {
      const { data: subs } = await supabase
        .from("homework_submissions")
        .select("*")
        .eq("student_id", userId);
      const map: Record<string, SubmissionRow> = {};
      for (const s of subs ?? []) {
        map[s.resource_id] = {
          ...s,
          files: (s.files as unknown as Array<{ path: string; name: string }>) ?? [],
        };
      }
      setSubmissions(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    reload(); /* eslint-disable-next-line */
  }, [isTutor, enrolledCourses.join(","), userId]);

  const { rows: analytics } = useAnalytics(userId, enrolledCourses);

  return (
    <AppLayout title="Homework & Grades">
      <p className="text-muted-foreground mb-6 max-w-2xl">
        {isTutor
          ? "Set homework in Tutor Studio and mark student submissions inline."
          : "Read each brief, upload your work, and see your grades and feedback as soon as your tutor marks them."}
      </p>

      {/* Predicted grades live in homework section now */}
      {!isTutor && enrolledCourses.length > 0 && analytics.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="font-display font-semibold text-base text-foreground">
              Predicted Grades
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {analytics.map((a) => (
              <div
                key={a.subject}
                className="rounded-2xl bg-card border border-border p-5 relative overflow-hidden shadow-xs"
              >
                <div
                  className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${subjectColor[a.subject] ?? "from-primary to-accent"}`}
                />
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  {subjectLabel[a.subject] ?? a.subject}
                </p>
                <p className="font-display text-2xl font-extrabold mt-1 text-foreground">
                  Grade {a.predictedGrade}
                </p>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border/60">
                  <span>
                    MCQs: <strong className="text-foreground">{a.mcqAverage}%</strong>
                  </span>
                  <span>
                    Homework: <strong className="text-foreground">{a.hwAverage}%</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : homework.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <ClipboardList className="w-8 h-8 mx-auto mb-3 opacity-50" />
          {isTutor ? "No homework set yet." : "No homework for your subjects yet."}
        </div>
      ) : (
        <div className="space-y-4">
          {homework.map((h) => (
            <HomeworkCard
              key={h.id}
              hw={h}
              submission={submissions[h.id]}
              userId={userId}
              onChanged={reload}
              readonly={isTutor || demo}
            />
          ))}
        </div>
      )}
    </AppLayout>
  );
}

function HomeworkCard({
  hw,
  submission,
  userId,
  onChanged,
  readonly,
}: {
  hw: Homework;
  submission?: SubmissionRow;
  userId: string | null;
  onChanged: () => void;
  readonly: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || files.length === 0) return toast.error("Choose at least one file");
    setUploading(true);
    try {
      const uploaded: Array<{ path: string; name: string }> = [];
      for (const f of files) {
        const path = `submissions/${userId}/${hw.id}/${crypto.randomUUID()}-${f.name}`;
        const { error } = await supabase.storage
          .from("resources")
          .upload(path, f, { upsert: false });
        if (error) throw error;
        uploaded.push({ path, name: f.name });
      }
      const { error } = await supabase.from("homework_submissions").upsert(
        {
          resource_id: hw.id,
          student_id: userId,
          files: uploaded,
          notes: notes || null,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "resource_id,student_id" },
      );
      if (error) throw error;
      toast.success("Homework submitted");
      setFiles([]);
      setNotes("");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const completed = !!submission;
  const isOverdue = hw.due_at && new Date(hw.due_at) < new Date() && !completed;
  const marked = submission?.graded_at != null;

  let cardBorderClass = "border-border";
  let statusLabel = "Due";
  let statusBadgeClass =
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20";

  if (completed) {
    cardBorderClass = "border-emerald-500/40 dark:border-emerald-500/30 bg-emerald-500/[0.005]";
    statusLabel = marked ? "Completed & Marked" : "Submitted";
    statusBadgeClass =
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20";
  } else if (isOverdue) {
    cardBorderClass = "border-rose-500/40 dark:border-rose-500/30 bg-rose-500/[0.005]";
    statusLabel = "Overdue";
    statusBadgeClass = "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20";
  } else {
    cardBorderClass = "border-amber-500/40 dark:border-amber-500/30 bg-amber-500/[0.005]";
    statusLabel = "Due";
    statusBadgeClass =
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20";
  }

  return (
    <div
      className={`rounded-2xl bg-card border-2 ${cardBorderClass} overflow-hidden shadow-xs transition duration-200`}
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-primary/10 text-primary">
                {hw.subject}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold ${statusBadgeClass}`}
              >
                {statusLabel}
              </span>
              {hw.due_at && (
                <span
                  className={`text-xs inline-flex items-center gap-1 ${isOverdue ? "text-rose-500" : "text-muted-foreground"}`}
                >
                  <Clock className="w-3 h-3" /> Due {new Date(hw.due_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <h3 className="font-display text-lg font-semibold">{hw.title}</h3>
            {hw.instructions && (
              <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                {hw.instructions}
              </p>
            )}
          </div>
        </div>

        {marked && submission && (
          <div className="mt-4 rounded-xl bg-accent/5 border border-accent/20 p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {submission.grade && (
                <span className="inline-flex items-center gap-1.5 text-xs bg-accent/15 border border-accent/20 text-accent font-semibold px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
                  Grade: {submission.grade}
                </span>
              )}
              {submission.score_pct != null && (
                <div className="relative group/pct inline-flex items-center gap-1.5 cursor-help">
                  <span className="inline-flex items-center text-xs bg-accent/10 text-accent font-semibold px-2.5 py-1 rounded-full border border-accent/20">
                    Score: {Number(submission.score_pct)}%
                  </span>
                  <Info className="w-3.5 h-3.5 text-accent shrink-0" />

                  {/* Hover diagnostic bubble */}
                  <div className="absolute left-0 top-full mt-2 w-72 p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl opacity-0 scale-95 pointer-events-none group-hover/pct:opacity-100 group-hover/pct:scale-100 transition duration-200 z-50 text-foreground font-sans normal-case text-xs leading-relaxed">
                    <p className="font-extrabold uppercase tracking-wider text-[10px] text-muted-foreground mb-2">
                      Syllabus Diagnostics (Parent Insight)
                    </p>
                    {hw.id === "hw-photosynthesis-factors" ? (
                      <div className="space-y-2 text-foreground">
                        <div className="flex justify-between items-center pb-1 border-b border-border">
                          <span className="font-medium text-muted-foreground text-[11px]">
                            Light Intensity & Inverse Square
                          </span>
                          <span className="font-bold text-emerald-500">95% (Mastered)</span>
                        </div>
                        <div className="flex justify-between items-center pb-1 border-b border-border">
                          <span className="font-medium text-muted-foreground text-[11px]">
                            Stomata & Gas Exchanges
                          </span>
                          <span className="font-bold text-emerald-500">86% (Strong)</span>
                        </div>
                        <div className="flex justify-between items-center bg-amber-500/10 p-2 rounded border border-amber-500/20">
                          <span className="font-semibold text-amber-500 text-[11px]">
                            Limiting Factors Graph Analysis
                          </span>
                          <span className="font-bold text-amber-500">55% (Struggling)</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1 leading-normal italic">
                          💡 Focus area: Practice explaining how rates plateau when CO₂
                          concentration is saturated and other limiting constraints take over.
                        </p>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        Diagnostics will compute automatically upon grading submission.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            {submission.feedback && (
              <div className="mt-3 pt-3 border-t border-accent/15">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-accent mb-2">
                  Tutor Feedback
                </p>
                <div className="p-3.5 bg-card border border-border rounded-xl text-foreground text-sm whitespace-pre-wrap leading-relaxed shadow-inner">
                  {submission.feedback}
                </div>
              </div>
            )}
          </div>
        )}

        {submission && submission.files.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Your submission
            </p>
            <ul className="space-y-1">
              {submission.files.map((f) => (
                <li key={f.path}>
                  <SignedFileLink file={f} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {!readonly && !submission && (
        <form onSubmit={submit} className="border-t border-border p-6 bg-muted/40 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Upload your work
          </p>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl p-6 cursor-pointer hover:border-primary/50 transition bg-card">
            <Upload className="w-6 h-6 text-primary" />
            <span className="text-sm">Click to choose files (PDF, DOCX, PNG, JPG)</span>
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          {files.length > 0 && (
            <ul className="space-y-1">
              {files.map((f, i) => (
                <li
                  key={i}
                  className="text-xs flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5"
                >
                  <FileText className="w-3 h-3 text-muted-foreground" /> {f.name}
                  <button
                    type="button"
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="ml-auto text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for your tutor (optional)"
            className="w-full min-h-16 rounded-lg bg-card border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            disabled={uploading}
            className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {uploading ? "Uploading…" : "Submit homework"}
          </button>
        </form>
      )}
    </div>
  );
}
