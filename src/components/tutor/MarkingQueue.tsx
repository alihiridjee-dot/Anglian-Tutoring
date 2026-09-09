import { useQueryClient } from "@tanstack/react-query";
import { invalidatePlanner } from "@/lib/planner/assessmentSync";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { toast } from "sonner";
import { ClipboardCheck, Clock, Inbox, Loader2, MessageSquare } from "lucide-react";
import { AnswerMarkingList } from "./AnswerMarking";
import { useAnswerMarking } from "@/hooks/data/useAnswerMarking";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";
import { subjectLabel } from "@/lib/courseSummary";
import { gradeFromPct } from "@/hooks/data/useAnalytics";

/** Derived lifecycle status for a submission. */
type SubmissionStatus = "PENDING_REVIEW" | "GRADED";

/**
 * How long is left before a mark goes out on its own.
 *
 * This is the queue's urgency axis, and it changed meaning when marking became
 * automatic. It used to measure the tutor's backlog — how long work had sat
 * ignored — which was the right pressure when nothing happened until someone
 * acted. Now something does happen: every submission is marked on arrival and
 * publishes itself a day later whether or not anyone looked. So the number that
 * matters is not how long this has been waiting, it is how long is left to
 * change it.
 */
type Urgency = "urgent" | "soon" | "fresh";

type Submission = {
  id: string;
  resource_id: string;
  student_id: string;
  notes: string | null;
  submitted_at: string;
  grade: string | null;
  score_pct: number | null;
  feedback: string | null;
  graded_by: string | null;
  graded_at: string | null;
  /** When this publishes itself if nobody gets to it first. */
  release_at: string | null;
  ai_marked_at: string | null;
  tutor_reviewed_at: string | null;
  resource: {
    id: string;
    title: string;
    subject: SubjectV | null;
    board: BoardV | null;
    level: LevelV | null;
    due_at: string | null;
  } | null;
};

function statusOf(s: Submission): SubmissionStatus {
  return s.graded_at ? "GRADED" : "PENDING_REVIEW";
}

/** Minutes until this publishes; null when nothing is staged to publish. */
function minutesToRelease(s: Submission): number | null {
  if (!s.release_at) return null;
  return (new Date(s.release_at).getTime() - Date.now()) / 60_000;
}

function urgencyOf(s: Submission): Urgency {
  const left = minutesToRelease(s);
  // Nothing staged: the model never marked it, so it needs a person and there
  // is no clock running. That is the most urgent thing in the queue, because
  // nothing will happen to it otherwise.
  if (left == null) return "urgent";
  if (left <= 5) return "urgent";
  if (left <= 15) return "soon";
  return "fresh";
}

/** Student handed it in after the due date. */
function isLate(s: Submission): boolean {
  const due = s.resource?.due_at;
  return !!due && new Date(s.submitted_at).getTime() > new Date(due).getTime();
}

export function MarkingQueue() {
  const { userId } = useRoles();
  const [subs, setSubs] = useState<Submission[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<SubmissionStatus>("PENDING_REVIEW");
  const [filters, setFilters] = useState<Filters>({});

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
    const allRows = (data ?? []) as Submission[];

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
        // Whatever publishes soonest, first — and anything with no mark staged
        // at the very top, since nothing will happen to it without a person.
        .sort((a, b) => {
          const left = (s: Submission) => minutesToRelease(s) ?? -Infinity;
          return left(a) - left(b);
        }),
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
        No homework submissions yet. Once students answer their homework it will appear here to
        review.
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
          label="To review"
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

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Inbox className="w-8 h-8 mx-auto mb-3 opacity-50" />
          {segment === "PENDING_REVIEW"
            ? "Nothing waiting to be reviewed here."
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
  onSaved,
}: {
  sub: Submission;
  studentName: string;
  graderId: string | null;
  onSaved: () => void;
}) {
  const plannerQueryClient = useQueryClient();
  const status = statusOf(sub);
  const [open, setOpen] = useState(false);
  const [scorePct, setScorePct] = useState<string>(
    sub.score_pct != null ? String(sub.score_pct) : "",
  );
  const [feedback, setFeedback] = useState(sub.feedback ?? "");
  const [saving, setSaving] = useState(false);

  // Built-in homework: the questions and this student's answers, loaded only
  // once the card is open.
  const marking = useAnswerMarking(sub.resource?.id, sub.id, open);

  // The awarded total is the honest source for score_pct, so keep the field in
  // step with the per-question marks until the tutor overrides it by hand.
  const [pctTouched, setPctTouched] = useState(false);
  useEffect(() => {
    if (pctTouched || !marking.hasQuestions || marking.scorePct == null) return;
    setScorePct(String(marking.scorePct));
  }, [pctTouched, marking.hasQuestions, marking.scorePct]);

  // Same for the overall comment: offered, not imposed. A tutor who has written
  // their own keeps it.
  const [feedbackTouched, setFeedbackTouched] = useState(false);
  useEffect(() => {
    if (feedbackTouched || !marking.summary || feedback.trim() !== "") return;
    setFeedback(marking.summary);
  }, [feedbackTouched, marking.summary, feedback]);

  const save = async () => {
    if (!graderId) return toast.error("Not signed in");
    const pct = scorePct.trim() === "" ? null : Number(scorePct);
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      return toast.error("Score must be between 0 and 100");
    }
    setSaving(true);
    try {
      // Per-question marks first: if one is out of range the overall mark isn't
      // written either, so the two can't disagree.
      if (marking.hasQuestions) await marking.saveMarks();

      const { error } = await supabase
        .from("homework_submissions")
        .update({
          // Derived, not typed. The marks are the mark; a grade box a tutor
          // filled in by hand was a second source of truth that could — and
          // did — disagree with the percentage printed next to it.
          grade: pct != null ? String(gradeFromPct(pct)) : null,
          score_pct: pct,
          feedback: feedback.trim() || null,
          graded_by: graderId,
          graded_at: new Date().toISOString(),
          // Publishing by hand is also the record that a person looked at it,
          // which is the difference between a checked mark and one that ran out
          // of clock.
          tutor_reviewed_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
      if (error) throw error;
      toast.success(`Marked ${studentName}'s submission`);
      void invalidatePlanner(plannerQueryClient, sub.student_id);
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
      <div className="flex items-center gap-3 pl-5 pr-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 flex items-center justify-between gap-4 py-4 pr-4 text-left"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              {subject && (
                <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-primary/10 text-primary">
                  {subjectLabel(subject)}
                </span>
              )}
              {isPending ? <UrgencyBadge sub={sub} /> : <GradedBadge />}
              {isLate(sub) && (
                <span className="text-[10px] px-2 py-0.5 rounded uppercase tracking-widest font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                  Late
                </span>
              )}
            </div>
            <p className="font-display font-bold truncate">
              {sub.resource?.title ?? "Untitled homework"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {studentName} · submitted {new Date(sub.submitted_at).toLocaleDateString()}
              {sub.grade ? ` · grade ${sub.grade}` : ""}
            </p>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{open ? "Hide" : "Review"}</span>
        </button>
      </div>

      {open && (
        <div className="border-t border-border p-6 space-y-5 bg-muted/20">
          {/* Submitted work */}
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground mb-2">
              Submitted work
            </p>
            {marking.loading ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading answers…
              </p>
            ) : marking.hasQuestions ? (
              // Built-in homework: the answers themselves are the work, and any
              // photos are shown inline against the question they belong to.
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Answered on the site — {marking.markedCount}/{marking.questions.length} marked,{" "}
                  {marking.awarded}/{marking.totalMarks} marks
                  {marking.scorePct != null ? ` (${marking.scorePct}%)` : ""}
                </p>
                <AnswerMarkingList
                  questions={marking.questions}
                  answers={marking.answers}
                  marks={marking.marks}
                  setMark={marking.setMark}
                />
              </div>
            ) : (
              // Submissions predating on-site answering were handed in as files.
              // Those files are gone, and nothing new can arrive this way.
              <p className="text-sm text-muted-foreground">
                This submission predates on-site answering and has no answers to show.
              </p>
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
          <label className="block max-w-xs">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Score % (feeds predicted grade)
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={scorePct}
              onChange={(e) => {
                setPctTouched(true);
                setScorePct(e.target.value);
              }}
              placeholder="0–100"
              className="mt-1 w-full h-10 rounded-lg premium-input px-3 text-sm"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {scorePct.trim() === ""
                ? "Adds up from the marks above."
                : `Grade ${gradeFromPct(Number(scorePct) || 0)}`}
            </span>
          </label>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Written feedback
            </span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Feedback the student will see on their dashboard…"
              className="mt-1 w-full min-h-28 rounded-lg premium-input px-3 py-2 text-sm"
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
              className="ml-auto inline-flex items-center gap-2 h-10 px-5 rounded-lg btn-solid text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ClipboardCheck className="w-4 h-4" />
              )}
              {isPending ? "Confirm & publish" : "Update mark"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * How long is left to change this before the student sees it.
 *
 * With a half-hour window this rarely reads as anything but "publishing now",
 * and that is honest: at this length review is a spot-check after the fact
 * rather than a gate, and most work a tutor opens will already be in the Marked
 * segment. The badge earns its place on the one row it still describes — work
 * with nothing staged at all, which no timer will ever release.
 */
function UrgencyBadge({ sub }: { sub: Submission }) {
  const urgency = urgencyOf(sub);
  const left = minutesToRelease(sub);
  const cls: Record<Urgency, string> = {
    urgent: "tint-rose chip",
    soon: "tint-amber chip",
    fresh: "tint-emerald chip",
  };

  const text =
    left == null
      ? "No marks yet"
      : left <= 0
        ? "Publishing now"
        : `Publishes in ${Math.ceil(left)} min`;

  return (
    <span className={`${cls[urgency]} inline-flex items-center gap-1`}>
      <Clock className="size-2.5" /> {text}
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
