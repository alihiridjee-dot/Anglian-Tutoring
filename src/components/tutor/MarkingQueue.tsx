import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { SignedFileLink } from "@/components/SignedFileLink";
import { toast } from "sonner";
import { ClipboardCheck, Clock, FileText, Inbox, Loader2, MessageSquare } from "lucide-react";

/** Derived lifecycle status for a submission. */
type SubmissionStatus = "PENDING_REVIEW" | "GRADED";

type SubmissionFile = { path: string; name: string };

type Submission = {
  id: string;
  resource_id: string;
  student_id: string;
  files: SubmissionFile[];
  notes: string | null;
  submitted_at: string;
  grade: string | null;
  score_pct: number | null;
  feedback: string | null;
  graded_by: string | null;
  graded_at: string | null;
  resource: { id: string; title: string; subject: string; due_at: string | null } | null;
};

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

function statusOf(s: Submission): SubmissionStatus {
  return s.graded_at ? "GRADED" : "PENDING_REVIEW";
}

export function MarkingQueue() {
  const { userId } = useRoles();
  const [subs, setSubs] = useState<Submission[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("homework_submissions")
      .select("*, resource:resources(id, title, subject, due_at)")
      .order("submitted_at", { ascending: true });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const allRows = (data ?? []).map((r) => ({
      ...r,
      files: (r.files as unknown as SubmissionFile[]) ?? [],
    })) as Submission[];

    // Resolve the author profiles so we can (a) show real names and (b) drop any
    // submission belonging to a public demo/sandbox account. The "demo platform"
    // is a separate, self-contained showcase — its accounts (is_demo = true) must
    // never surface work in the tutor's real marking queue. Genuine students,
    // including test students like Bob, are is_demo = false and always shown.
    const ids = [...new Set(allRows.map((r) => r.student_id))];
    const map: Record<string, string> = {};
    const demoStudentIds = new Set<string>();
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, is_demo")
        .in("id", ids);
      for (const p of profs ?? []) {
        map[p.id] = p.display_name ?? "";
        if (p.is_demo) demoStudentIds.add(p.id);
      }
    }

    const rows = allRows.filter((r) => !demoStudentIds.has(r.student_id));
    setSubs(rows);
    setNames(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Outstanding (ungraded) submissions come first — oldest submitted at the top
  // so the longest-waiting student is prioritized. Graded work sinks below,
  // most-recently-marked first.
  const ordered = useMemo(() => {
    return [...subs].sort((a, b) => {
      const aPending = statusOf(a) === "PENDING_REVIEW";
      const bPending = statusOf(b) === "PENDING_REVIEW";
      if (aPending !== bPending) return aPending ? -1 : 1;
      if (aPending) return a.submitted_at.localeCompare(b.submitted_at);
      return (b.graded_at ?? "").localeCompare(a.graded_at ?? "");
    });
  }, [subs]);

  const outstanding = ordered.filter((s) => statusOf(s) === "PENDING_REVIEW").length;
  const graded = ordered.length - outstanding;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading submissions…
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
        <Inbox className="w-8 h-8 mx-auto mb-3 opacity-50" />
        No homework submissions yet. Once students upload their work it will appear here for marking.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2.5">
          <ClipboardCheck className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            {outstanding} outstanding
          </span>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5">
          <CheckIcon />
          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            {graded} graded
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {ordered.map((s) => (
          <MarkSubmissionCard
            key={s.id}
            sub={s}
            studentName={names[s.student_id] || `Student ${s.student_id.slice(0, 8)}`}
            graderId={userId}
            onSaved={reload}
          />
        ))}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <span className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
    </span>
  );
}

function MarkSubmissionCard({
  sub,
  studentName,
  graderId,
  onSaved,
}: {
  sub: Submission;
  studentName: string;
  graderId: string | null;
  onSaved: () => void;
}) {
  const status = statusOf(sub);
  const [open, setOpen] = useState(status === "PENDING_REVIEW");
  const [grade, setGrade] = useState(sub.grade ?? "");
  const [scorePct, setScorePct] = useState<string>(sub.score_pct != null ? String(sub.score_pct) : "");
  const [feedback, setFeedback] = useState(sub.feedback ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!graderId) return toast.error("Not signed in");
    const pct = scorePct.trim() === "" ? null : Number(scorePct);
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      return toast.error("Score must be between 0 and 100");
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("homework_submissions")
        .update({
          grade: grade.trim() || null,
          score_pct: pct,
          feedback: feedback.trim() || null,
          graded_by: graderId,
          graded_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
      if (error) throw error;
      toast.success(`Marked ${studentName}'s submission`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save mark");
    } finally {
      setSaving(false);
    }
  };

  const subject = sub.resource?.subject ?? "";
  const isPending = status === "PENDING_REVIEW";

  return (
    <div
      className={`rounded-2xl bg-card border-2 overflow-hidden shadow-xs transition ${
        isPending
          ? "border-amber-500/40 dark:border-amber-500/30"
          : "border-emerald-500/30 dark:border-emerald-500/25"
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 px-6 py-4 text-left hover:bg-muted/40"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {subject && (
              <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-primary/10 text-primary">
                {subjectLabel[subject] ?? subject}
              </span>
            )}
            <StatusBadge status={status} />
          </div>
          <p className="font-display font-semibold truncate">
            {sub.resource?.title ?? "Untitled homework"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {studentName} · submitted {new Date(sub.submitted_at).toLocaleDateString()}
            {sub.grade ? ` · grade ${sub.grade}` : ""}
          </p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{open ? "Hide" : "Mark"}</span>
      </button>

      {open && (
        <div className="border-t border-border p-6 space-y-5 bg-muted/20">
          {/* Submitted work */}
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground mb-2">
              Submitted work
            </p>
            {sub.files.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files attached.</p>
            ) : (
              <ul className="space-y-1">
                {sub.files.map((f) => (
                  <li key={f.path}>
                    <SignedFileLink file={f} />
                  </li>
                ))}
              </ul>
            )}
            {sub.notes && (
              <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span className="italic">{sub.notes}</span>
              </div>
            )}
            {sub.resource?.due_at && (
              <p className="mt-2 text-xs text-muted-foreground inline-flex items-center gap-1">
                <Clock className="w-3 h-3" /> Due {new Date(sub.resource.due_at).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Marking form */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Grade (letter or number)
              </span>
              <input
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="e.g. A, 7, 18/20"
                className="mt-1 w-full h-10 rounded-lg bg-card border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Score % (feeds predicted grade)
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={scorePct}
                onChange={(e) => setScorePct(e.target.value)}
                placeholder="0–100"
                className="mt-1 w-full h-10 rounded-lg bg-card border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Written feedback
            </span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Feedback the student will see on their dashboard…"
              className="mt-1 w-full min-h-28 rounded-lg bg-card border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            {sub.graded_at && (
              <span className="text-[11px] text-muted-foreground">
                Last marked {new Date(sub.graded_at).toLocaleString()}
              </span>
            )}
            <button
              onClick={save}
              disabled={saving}
              className="ml-auto inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ClipboardCheck className="w-4 h-4" />
              )}
              {isPending ? "Save & mark graded" : "Update mark"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SubmissionStatus }) {
  if (status === "GRADED") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
        <FileText className="w-2.5 h-2.5" /> Graded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
      <Clock className="w-2.5 h-2.5" /> Pending review
    </span>
  );
}
