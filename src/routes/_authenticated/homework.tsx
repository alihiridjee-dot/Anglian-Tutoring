import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { ClipboardList, Upload, FileText, X, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/homework")({
  head: () => ({ meta: [{ title: "Homework & Grades | Anglian Tutoring" }] }),
  component: HomeworkPage,
});

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
  const { enrolledCourses } = useEnrolments();
  const [homework, setHomework] = useState<Homework[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionRow>>({});
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
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

  return (
    <AppLayout title="Homework & Grades">
      <p className="text-muted-foreground mb-6 max-w-2xl">
        {isTutor
          ? "Set homework in Tutor Studio and mark student submissions inline."
          : "Read each brief, upload your work, and see your grades and feedback as soon as your tutor marks them."}
      </p>
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
              readonly={isTutor}
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

  const overdue = hw.due_at && new Date(hw.due_at) < new Date() && !submission;
  const marked = submission?.graded_at != null;

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-primary/10 text-primary">
                {hw.subject}
              </span>
              {hw.due_at && (
                <span
                  className={`text-xs inline-flex items-center gap-1 ${overdue ? "text-destructive" : "text-muted-foreground"}`}
                >
                  <Clock className="w-3 h-3" /> Due {new Date(hw.due_at).toLocaleDateString()}
                </span>
              )}
              {marked && (
                <span className="text-xs inline-flex items-center gap-1 text-accent">
                  <CheckCircle2 className="w-3 h-3" /> Marked
                </span>
              )}
              {submission && !marked && (
                <span className="text-xs text-muted-foreground">Submitted, awaiting mark</span>
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
          <div className="mt-4 rounded-xl bg-accent/5 border border-accent/30 p-4">
            <div className="flex items-baseline gap-3">
              {submission.grade && (
                <span className="font-display text-2xl font-bold text-accent">
                  {submission.grade}
                </span>
              )}
              {submission.score_pct != null && (
                <span className="text-sm text-muted-foreground">
                  {Number(submission.score_pct)}%
                </span>
              )}
            </div>
            {submission.feedback && (
              <p className="mt-2 text-sm whitespace-pre-wrap">{submission.feedback}</p>
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
                <li key={f.path} className="text-sm flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" /> {f.name}
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
