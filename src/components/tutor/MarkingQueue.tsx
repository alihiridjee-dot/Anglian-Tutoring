import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { SignedFileLink } from "@/components/SignedFileLink";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { downloadEntriesAsZip, downloadSingleFile, type ZipEntry } from "@/lib/homeworkDownload";
import { toast } from "sonner";
import { ClipboardCheck, Clock, Download, Inbox, Loader2, MessageSquare } from "lucide-react";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";

/** Derived lifecycle status for a submission. */
type SubmissionStatus = "PENDING_REVIEW" | "GRADED";

/**
 * How long a tutor has left submitted work unmarked. This is the queue's
 * urgency axis — it's about the tutor's backlog, not the student's deadline
 * (that's `isLate`).
 */
type Urgency = "urgent" | "soon" | "fresh";

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
  resource: {
    id: string;
    title: string;
    subject: SubjectV | null;
    board: BoardV | null;
    level: LevelV | null;
    due_at: string | null;
  } | null;
};

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

const DAY_MS = 86_400_000;

function statusOf(s: Submission): SubmissionStatus {
  return s.graded_at ? "GRADED" : "PENDING_REVIEW";
}

function daysWaiting(s: Submission): number {
  return Math.floor((Date.now() - new Date(s.submitted_at).getTime()) / DAY_MS);
}

function urgencyOf(s: Submission): Urgency {
  const d = daysWaiting(s);
  if (d >= 5) return "urgent";
  if (d >= 2) return "soon";
  return "fresh";
}

/** Student handed it in after the due date. */
function isLate(s: Submission): boolean {
  const due = s.resource?.due_at;
  return !!due && new Date(s.submitted_at).getTime() > new Date(due).getTime();
}

/** Folder name for this submission inside a bulk zip. */
function zipFolder(s: Submission, studentName: string): string {
  return `${studentName} - ${s.resource?.title ?? "Untitled homework"}`;
}

export function MarkingQueue() {
  const { userId } = useRoles();
  const [subs, setSubs] = useState<Submission[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<SubmissionStatus>("PENDING_REVIEW");
  const [filters, setFilters] = useState<Filters>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 });

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("homework_submissions")
      .select("*, resource:resources(id, title, subject, board, level, due_at)")
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

    // Resolve the author profiles so we can show real names. Every submission
    // here is genuine: the public demo is a session-less showcase that cannot
    // sign in or submit anything, so there is no sandbox work to filter out.
    const ids = [...new Set(allRows.map((r) => r.student_id))];
    const map: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      for (const p of profs ?? []) {
        map[p.id] = p.display_name ?? "";
      }
    }

    setSubs(allRows);
    setNames(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const nameOf = useCallback((id: string) => names[id] || `Student ${id.slice(0, 8)}`, [names]);

  // Site-wide subject/board/level filters, applied before segmenting so the
  // segment counts always describe what the tutor is actually looking at.
  const visible = useMemo(() => {
    return subs.filter((s) => {
      if (filters.subject && s.resource?.subject !== filters.subject) return false;
      if (filters.board && s.resource?.board !== filters.board) return false;
      if (filters.level && s.resource?.level !== filters.level) return false;
      return true;
    });
  }, [subs, filters]);

  const pending = useMemo(
    () =>
      visible
        .filter((s) => statusOf(s) === "PENDING_REVIEW")
        // Longest-waiting first — the queue's whole job is surfacing these.
        .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)),
    [visible],
  );

  const graded = useMemo(
    () =>
      visible
        .filter((s) => statusOf(s) === "GRADED")
        .sort((a, b) => (b.graded_at ?? "").localeCompare(a.graded_at ?? "")),
    [visible],
  );

  const shown = segment === "PENDING_REVIEW" ? pending : graded;
  const urgentCount = pending.filter((s) => urgencyOf(s) === "urgent").length;

  // A submission stays selectable only while it's visible; drop stale ids so the
  // bulk bar can never act on something off-screen.
  const shownIds = useMemo(() => new Set(shown.map((s) => s.id)), [shown]);
  const activeSelection = useMemo(() => shown.filter((s) => selected.has(s.id)), [shown, selected]);
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => shownIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [shownIds]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allShownSelected = shown.length > 0 && activeSelection.length === shown.length;
  const toggleAll = () =>
    setSelected(allShownSelected ? new Set() : new Set(shown.map((s) => s.id)));

  const bulkDownload = async () => {
    const entries: ZipEntry[] = activeSelection.flatMap((s) =>
      s.files.map((file) => ({ folder: zipFolder(s, nameOf(s.student_id)), file })),
    );
    if (entries.length === 0) {
      return toast.error("The selected submissions have no files attached");
    }
    setZipping(true);
    setZipProgress({ done: 0, total: entries.length });
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const { zipped, failed } = await downloadEntriesAsZip(
        entries,
        `homework-${stamp}.zip`,
        (done, total) => setZipProgress({ done, total }),
      );
      if (failed.length > 0) {
        toast.warning(
          `Downloaded ${zipped} file${zipped === 1 ? "" : "s"} — ${failed.length} failed`,
        );
      } else {
        toast.success(`Downloaded ${zipped} file${zipped === 1 ? "" : "s"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setZipping(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading submissions…
      </div>
    );
  }

  if (subs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
        <Inbox className="w-8 h-8 mx-auto mb-3 opacity-50" />
        No homework submissions yet. Once students upload their work it will appear here for
        marking.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Status segments — the primary axis. Only one status is on screen at a
          time, so "what needs attention" is never mixed in with finished work. */}
      <div className="flex flex-wrap gap-2">
        <SegmentTab
          active={segment === "PENDING_REVIEW"}
          onClick={() => setSegment("PENDING_REVIEW")}
          label="Needs marking"
          count={pending.length}
          tone="amber"
          badge={urgentCount > 0 ? `${urgentCount} urgent` : undefined}
        />
        <SegmentTab
          active={segment === "GRADED"}
          onClick={() => setSegment("GRADED")}
          label="Marked"
          count={graded.length}
          tone="emerald"
        />
      </div>

      <FilterBar value={filters} onChange={setFilters} />

      {shown.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={toggleAll}
              className="w-4 h-4 rounded border-border accent-primary"
            />
            <span className="text-muted-foreground">
              {activeSelection.length > 0
                ? `${activeSelection.length} selected`
                : `Select all ${shown.length}`}
            </span>
          </label>

          {activeSelection.length > 0 && (
            <>
              <button
                onClick={bulkDownload}
                disabled={zipping}
                className="ml-auto inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
              >
                {zipping ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {zipping ? `Zipping ${zipProgress.done}/${zipProgress.total}…` : "Download as ZIP"}
              </button>
              <button
                onClick={() => setSelected(new Set())}
                disabled={zipping}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Inbox className="w-8 h-8 mx-auto mb-3 opacity-50" />
          {segment === "PENDING_REVIEW"
            ? "Nothing waiting to be marked here."
            : "No marked submissions here yet."}
          {(filters.subject || filters.board || filters.level) && " Try clearing the filters."}
        </div>
      ) : (
        <div className="space-y-4">
          {shown.map((s) => (
            <MarkSubmissionCard
              key={s.id}
              sub={s}
              studentName={nameOf(s.student_id)}
              graderId={userId}
              selected={selected.has(s.id)}
              onToggleSelect={() => toggle(s.id)}
              onSaved={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SegmentTab({
  active,
  onClick,
  label,
  count,
  tone,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone: "amber" | "emerald";
  badge?: string;
}) {
  const activeCls =
    tone === "amber"
      ? "bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300"
      : "bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-300";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? activeCls
          : "bg-secondary border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      <span
        className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] ${
          active ? "bg-background/60" : "bg-background/60 text-muted-foreground"
        }`}
      >
        {count}
      </span>
      {badge && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
          {badge}
        </span>
      )}
    </button>
  );
}

function MarkSubmissionCard({
  sub,
  studentName,
  graderId,
  selected,
  onToggleSelect,
  onSaved,
}: {
  sub: Submission;
  studentName: string;
  graderId: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  onSaved: () => void;
}) {
  const status = statusOf(sub);
  const [open, setOpen] = useState(false);
  const [grade, setGrade] = useState(sub.grade ?? "");
  const [scorePct, setScorePct] = useState<string>(
    sub.score_pct != null ? String(sub.score_pct) : "",
  );
  const [feedback, setFeedback] = useState(sub.feedback ?? "");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

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

  const downloadAll = async () => {
    setDownloading(true);
    try {
      if (sub.files.length === 1) {
        await downloadSingleFile(sub.files[0]);
      } else {
        const folder = zipFolder(sub, studentName);
        await downloadEntriesAsZip(
          sub.files.map((file) => ({ folder, file })),
          `${folder}.zip`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const subject = sub.resource?.subject ?? "";
  const isPending = status === "PENDING_REVIEW";

  return (
    <div
      className={`rounded-2xl bg-card border-2 overflow-hidden shadow-xs transition ${
        selected
          ? "border-primary"
          : isPending
            ? "border-amber-500/40 dark:border-amber-500/30"
            : "border-emerald-500/30 dark:border-emerald-500/25"
      }`}
    >
      <div className="flex items-center gap-3 pl-5 pr-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${studentName}'s submission`}
          className="w-4 h-4 shrink-0 rounded border-border accent-primary"
        />
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 flex items-center justify-between gap-4 py-4 pr-4 text-left"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              {subject && (
                <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-primary/10 text-primary">
                  {subjectLabel[subject] ?? subject}
                </span>
              )}
              {isPending ? <UrgencyBadge sub={sub} /> : <GradedBadge />}
              {isLate(sub) && (
                <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                  Late
                </span>
              )}
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
      </div>

      {open && (
        <div className="border-t border-border p-6 space-y-5 bg-muted/20">
          {/* Submitted work */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                Submitted work
              </p>
              {sub.files.length > 0 && (
                <button
                  onClick={downloadAll}
                  disabled={downloading}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  {downloading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Download {sub.files.length > 1 ? `all ${sub.files.length}` : "file"}
                </button>
              )}
            </div>
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
                <Clock className="w-3 h-3" /> Due{" "}
                {new Date(sub.resource.due_at).toLocaleDateString()}
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

/**
 * Colour-coded by how long the work has sat unmarked: red once it's been
 * ignored for most of a week, amber after a couple of days, green while fresh.
 */
function UrgencyBadge({ sub }: { sub: Submission }) {
  const urgency = urgencyOf(sub);
  const days = daysWaiting(sub);
  const cls: Record<Urgency, string> = {
    urgent: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    soon: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    fresh: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  };
  const text = days < 1 ? "Today" : days === 1 ? "Waiting 1 day" : `Waiting ${days} days`;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold border ${cls[urgency]}`}
    >
      <Clock className="w-2.5 h-2.5" /> {text}
    </span>
  );
}

function GradedBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
      <ClipboardCheck className="w-2.5 h-2.5" /> Graded
    </span>
  );
}
