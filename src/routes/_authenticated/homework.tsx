import { createFileRoute } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/routeGuards";
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import {
  useHomework,
  useHomeworkSubmissions,
  useInvalidateHomework,
  type Homework,
  type SubmissionRow,
} from "@/hooks/data/useHomework";
import {
  ClipboardList,
  Upload,
  FileText,
  X,
  CheckCircle2,
  ChevronDown,
  Clock,
  Info,
  TrendingUp,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { SignedFileLink } from "@/components/SignedFileLink";
import { MarkingQueue } from "@/components/tutor/MarkingQueue";
import { HomeworkForm } from "@/components/tutor/HomeworkForm";
import { prepareUpload, formatBytes, MAX_UPLOAD_BYTES } from "@/lib/uploadLimits";
import { acknowledgeSubmission, deleteHomework } from "@/lib/homework.functions";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

export const Route = createFileRoute("/_authenticated/homework")({
  beforeLoad: guardStudentSection,
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

/**
 * Closes the feedback loop: the student confirms they've read the mark, which
 * notifies the tutor and drops the uploaded files from storage.
 *
 * The deletion is spelled out up front — it's irreversible, and a student who
 * wants to keep their work needs to download it before clicking.
 */
function AcknowledgeFeedback({
  submission,
  onChanged,
}: {
  submission: SubmissionRow;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  if (submission.acknowledged_at) {
    return (
      <div className="mt-3 pt-3 border-t border-accent/15 flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        You acknowledged this feedback on{" "}
        {new Date(submission.acknowledged_at).toLocaleDateString()}
      </div>
    );
  }

  const acknowledge = async () => {
    setSaving(true);
    try {
      await acknowledgeSubmission({ data: { submissionId: submission.id } });
      toast.success("Feedback acknowledged — your tutor has been notified");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not acknowledge feedback");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-accent/15 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground max-w-md">
        Let your tutor know you've read this. Your uploaded files will be removed to save space —
        download them first if you want to keep them. Your grade and feedback stay.
      </p>
      <button
        onClick={acknowledge}
        disabled={saving}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 shrink-0"
      >
        <CheckCircle2 className="w-4 h-4" />
        {saving ? "Acknowledging…" : "Acknowledge"}
      </button>
    </div>
  );
}

export function HomeworkPage() {
  const { isTutor, userId, loading: rolesLoading } = useRoles();
  const demo = isDemoStudent();
  const { enrolledCourses, loading: enrolmentsLoading } = useEnrolments();

  // Both queries key off role and enrolled subjects, so hold them until those
  // have settled — querying with a half-known identity would filter wrongly.
  const identityReady = demo || (!rolesLoading && !enrolmentsLoading);

  const { data: homework = [], isPending: homeworkPending } = useHomework({
    isTutor,
    subjects: enrolledCourses,
    enabled: identityReady,
  });
  // Only a student has submissions to fetch, and only the demo one has them
  // without a userId.
  const wantsSubmissions = !isTutor && (demo || !!userId);
  const { data: submissions = {}, isPending: submissionsPending } = useHomeworkSubmissions({
    userId,
    enabled: identityReady && wantsSubmissions,
  });
  const reload = useInvalidateHomework();

  // A disabled query stays pending forever, so only wait on one that will run.
  const loading = !identityReady || homeworkPending || (wantsSubmissions && submissionsPending);

  const { rows: analytics } = useAnalytics(userId, enrolledCourses);

  // Homework & Grades is the dedicated marking section: for a tutor the page is
  // the marking queue itself, not a read-only list of briefs. The briefs they've
  // set stay available below as secondary context.
  if (isTutor) {
    return (
      <AppLayout title="Homework & Grades">
        <p className="text-muted-foreground mb-6 max-w-2xl">
          Set new homework, then mark student submissions — segmented by status, filtered by
          subject, board and level.
        </p>
        {userId && <SetHomeworkPanel userId={userId} />}
        <MarkingQueue />
        <TutorBriefs homework={homework} loading={loading} onDeleted={reload} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Homework & Grades">
      <p className="text-muted-foreground mb-6 max-w-2xl">
        Read each brief, upload your work, and see your grades and feedback as soon as your tutor
        marks them.
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
          No homework for your subjects yet.
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
              readonly={demo}
            />
          ))}
        </div>
      )}
    </AppLayout>
  );
}

/**
 * Set homework straight from the Homework & Grades tab, so a tutor doesn't have
 * to detour through Tutor Studio to post a brief. Reuses the same form and
 * insert path; taxonomy state is local to the panel.
 */
function SetHomeworkPanel({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<SubjectV>("biology");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [level, setLevel] = useState<LevelV>("gcse");

  return (
    <div className="mb-8 rounded-2xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/40"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Plus className="w-4 h-4 text-primary" />
          Set new homework
        </span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-border p-5">
          <HomeworkForm
            userId={userId}
            taxonomy={{ subject, setSubject, board, setBoard, level, setLevel }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The briefs a tutor has set, kept collapsed beneath the marking queue. It's
 * reference material rather than something needing action, so it stays out of
 * the way until asked for — plus a delete escape hatch for briefs posted in
 * error.
 */
function TutorBriefs({
  homework,
  loading,
  onDeleted,
}: {
  homework: Homework[];
  loading: boolean;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-8 rounded-2xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-muted/40"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="w-4 h-4 text-muted-foreground" />
          Homework you've set
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-secondary text-[11px] text-muted-foreground">
            {loading ? "…" : homework.length}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-border p-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : homework.length === 0 ? (
            <p className="text-sm text-muted-foreground">No homework set yet — set one above.</p>
          ) : (
            <ul className="divide-y divide-border">
              {homework.map((h) => (
                <TutorBriefRow key={h.id} hw={h} onDeleted={onDeleted} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A single set-homework row with a delete control. Deletion is destructive and
 * system-wide — it removes the brief and every student's submission for it — so
 * it's gated behind an inline confirm rather than a one-click button.
 */
function TutorBriefRow({ hw, onDeleted }: { hw: Homework; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteHomework({ data: { homeworkId: hw.id } });
      toast.success("Homework deleted for everyone");
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete homework");
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-primary/10 text-primary">
          {hw.subject}
        </span>
        <span className="text-sm font-medium">{hw.title}</span>
        {hw.due_at && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Clock className="w-3 h-3" /> Due {new Date(hw.due_at).toLocaleDateString()}
          </span>
        )}

        {confirming ? (
          <span className="ml-auto inline-flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Delete for all students?</span>
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-destructive text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60"
            >
              <Trash2 className="w-3 h-3" />
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="h-7 px-2.5 rounded-md border border-border text-xs font-medium hover:bg-muted/50 disabled:opacity-60"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        )}
      </div>
    </li>
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
      // Photos come off a phone at several MB; shrink them to fit the 1 MB cap
      // before anything is uploaded, and fail the whole submission if one can't
      // be made to fit — a partial upload would leave orphaned files behind.
      const prepared: File[] = [];
      let shrunk = 0;
      for (const f of files) {
        const result = await prepareUpload(f);
        if (!result.ok) {
          toast.error(result.reason);
          setUploading(false);
          return;
        }
        if (result.compressed) shrunk++;
        prepared.push(result.file);
      }
      if (shrunk > 0) {
        toast.info(`Compressed ${shrunk} image${shrunk === 1 ? "" : "s"} to fit the 1 MB limit`);
      }

      const uploaded: Array<{ path: string; name: string }> = [];
      for (const f of prepared) {
        const path = `submissions/${userId}/${hw.id}/${crypto.randomUUID()}-${f.name}`;
        const { error } = await supabase.storage
          .from("resources")
          .upload(path, f, { upsert: false });
        if (error) throw error;
        uploaded.push({ path, name: f.name });
      }
      // A submission is final — insert, never upsert. RLS grants students
      // INSERT only, and UNIQUE (resource_id, student_id) rejects a second
      // attempt, so a stale tab cannot overwrite submitted (or graded) work.
      const { error } = await supabase.from("homework_submissions").insert({
        resource_id: hw.id,
        student_id: userId,
        files: uploaded,
        notes: notes || null,
        submitted_at: new Date().toISOString(),
      });
      if (error) {
        if (error.code === "23505") {
          toast.error("You've already submitted this homework — submissions are final.");
          onChanged();
          return;
        }
        throw error;
      }
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
                <span className="inline-flex items-center text-xs bg-accent/10 text-accent font-semibold px-2.5 py-1 rounded-full border border-accent/20">
                  Score: {Number(submission.score_pct)}%
                </span>
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
            {!readonly && <AcknowledgeFeedback submission={submission} onChanged={onChanged} />}
          </div>
        )}

        {submission && submission.files.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Your submission
            </p>
            <ul className="space-y-1">
              {submission.files.map((f) =>
                // Once the bytes are gone the path no longer resolves, so show
                // what was handed in rather than a link that would 404.
                submission.files_deleted_at ? (
                  <li
                    key={f.path}
                    className="text-sm inline-flex items-center gap-2 text-muted-foreground"
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="line-through">{f.name}</span>
                    <span className="text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      Removed
                    </span>
                  </li>
                ) : (
                  <li key={f.path}>
                    <SignedFileLink file={f} />
                  </li>
                ),
              )}
            </ul>
            {submission.files_deleted_at && (
              <p className="mt-2 text-xs text-muted-foreground">
                Your files were removed to save space. Your grade and feedback are kept.
              </p>
            )}
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
            <span className="text-[11px] text-muted-foreground">
              Max {formatBytes(MAX_UPLOAD_BYTES)} per file — photos are compressed automatically
            </span>
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
              {files.map((f, i) => {
                // Images over the cap get shrunk on submit, so flag them as
                // "will compress" rather than as a problem.
                const over = f.size > MAX_UPLOAD_BYTES;
                const fixable = over && f.type.startsWith("image/");
                return (
                  <li
                    key={i}
                    className="text-xs flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5"
                  >
                    <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{f.name}</span>
                    <span
                      className={
                        over && !fixable
                          ? "text-destructive shrink-0"
                          : "text-muted-foreground shrink-0"
                      }
                    >
                      {formatBytes(f.size)}
                    </span>
                    {fixable && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                        Will compress
                      </span>
                    )}
                    {over && !fixable && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive shrink-0">
                        Too large
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="ml-auto text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for your tutor (optional)"
            className="w-full min-h-16 rounded-lg bg-card border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Submissions are final — once you submit, you can't change or remove your work. Check
            your files before submitting.
          </p>
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
