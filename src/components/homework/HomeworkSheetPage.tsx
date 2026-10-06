import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { AwaitingMark, BuiltInHomework } from "@/components/BuiltInHomework";
import { EmptyState, ErrorNote, SciText, SectionHeading, Spinner } from "@/components/Shared";
import { useHomeworkSheet, useInvalidateHomework } from "@/hooks/data/useHomework";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { isOverdue } from "@/lib/homework/homeworkBuckets";
import type { SubmissionRow } from "@/lib/homework/types";
import { useRoles } from "@/hooks/useRole";
import { acknowledgeSubmission } from "@/lib/homework/homework.functions";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { studentBreaksQuery } from "@/lib/planner/breakQueries";
import { plannerDateLabel } from "@/lib/planner/week";
import { needsMarkingStart, startMarking } from "@/lib/homework/startMarking";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { usePinSubject } from "@/hooks/useActiveSubject";

export function HomeworkSheetPage() {
  // `strict: false` because this component is mounted twice — here, and again
  // under /demo/student for the signed-out showcase. Binding the params to one
  // route id would make it readable from only one of them.
  const params = useParams({ strict: false }) as { homeworkId?: string };
  const homeworkId = params.homeworkId ?? "";
  const { isTutor, userId, loading: rolesLoading } = useRoles();
  const demo = isDemoStudent();
  const reload = useInvalidateHomework();
  const { enrolments } = useEnrolments();
  const { data: breaks } = useQuery({
    ...studentBreaksQuery(userId ?? ""),
    enabled: !!userId && !isTutor && !isDemoStudent(),
  });

  const { data, isPending, error, refetch } = useHomeworkSheet({
    homeworkId,
    // A tutor is previewing, not answering, so they carry no submission into
    // the query and get the blank paper.
    userId: isTutor ? null : userId,
    enabled: demo || !rolesLoading,
  });

  // Work handed in whose marking never started: the submit's reply was lost,
  // so the page that sent it never asked. Ask now (see startMarking).
  const submission = data?.submission ?? null;
  useEffect(() => {
    if (demo || isTutor || !submission || !needsMarkingStart(submission)) return;
    startMarking(submission.id);
  }, [demo, isTutor, submission]);

  // A sheet belongs to one subject: opening it moves the header slider there,
  // and switching subject from here goes back to the list for the new one.
  const navigate = useNavigate();
  usePinSubject(data?.hw.subject, () =>
    navigate({ to: demo ? "/demo/student/homework" : "/homework" }),
  );

  if (!demo && rolesLoading)
    return (
      <AppLayout title="Task">
        <Spinner label="Loading" />
      </AppLayout>
    );

  if (error) {
    return (
      <AppLayout title="Task">
        <BackLink />
        <div className="mt-6">
          <ErrorNote error={error} onRetry={() => void refetch()} />
        </div>
      </AppLayout>
    );
  }

  if (isPending || !data) {
    return (
      <AppLayout title="Task">
        <BackLink />
        <Spinner label="Opening this task" />
      </AppLayout>
    );
  }

  const { hw, questions, answers } = data;
  const marked = !!submission?.graded_at;
  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
  // The same rule as the list, so a brief set before the student joined, or
  // due during their break, isn't Overdue here either.
  const overdue = isOverdue({
    hw,
    submission: submission ?? undefined,
    enrolledAt: enrolments.find((e) => e.subject === hw.subject)?.enrolledAt,
    breaks,
  });

  return (
    <AppLayout title={hw.title}>
      <div className={SUBJECT_TINT[hw.subject] ?? "tint-primary"}>
        <BackLink />

        {/* Laid out like the front of an exam paper: the title, one plain line
            under it, and the total marks boxed in the corner. The subject needs
            no label — the header slider names it and the tint is its colour. */}
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-extrabold sm:text-3xl">{hw.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span>
                {questions.length > 0 &&
                  `${questions.length} question${questions.length === 1 ? "" : "s"} · `}
                {hw.origin === "tutor" ? "Set by your tutor" : "Practice"}
                {/* A deadline is only news while it can still be missed. Once
                    the work is in, "Due 3rd September" beside a mark reads as a
                    reproach for something the student already did. */}
                {hw.due_at &&
                  !submission &&
                  !overdue &&
                  ` · Due ${plannerDateLabel(new Date(hw.due_at))}`}
              </span>
              {hw.due_at && !submission && overdue && (
                <span className="chip tint-rose inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden />
                  Overdue {plannerDateLabel(new Date(hw.due_at))}
                </span>
              )}
            </div>
          </div>
          {questions.length > 0 && (
            <div className="premium-card shrink-0 px-4 py-2.5 text-center">
              <p className="numeral text-3xl text-[color:var(--tint)]">{totalMarks}</p>
              <p className="mt-1 text-sm font-bold">mark{totalMarks === 1 ? "" : "s"}</p>
            </div>
          )}
        </div>

        {hw.instructions && (
          <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-relaxed whitespace-pre-wrap">
            <SciText text={hw.instructions} />
          </p>
        )}

        {isTutor && !demo && (
          <p className="premium-card text-muted-foreground mt-5 p-4 text-sm">
            This is the sheet as a student sees it, with the mark schemes shown. Marking happens in
            the queue on the{" "}
            <Link to="/homework" className="font-semibold underline">
              Tasks &amp; Grades
            </Link>{" "}
            page.
          </p>
        )}

        {/* The mark, once it has been released. */}
        {marked && submission && (
          <div className="mt-6">
            <MarkPanel submission={submission} readonly={demo} onChanged={reload} />
          </div>
        )}

        {/* Handed in, still inside its review window. */}
        {submission && !marked && (
          <div className="mt-6">
            <AwaitingMark releaseAt={submission.release_at} />
          </div>
        )}

        <div className="mt-8">
          {questions.length === 0 ? (
            <EmptyState
              mascot="books"
              title="Nothing to answer here"
              body="This task has no questions on it yet. Your tutor may still be putting it together — check back, or ask them about it."
            />
          ) : (
            <BuiltInHomework
              hw={hw}
              questions={questions}
              userId={userId}
              submission={submission ?? undefined}
              answers={answers}
              onChanged={reload}
              // The showcase answers like a student (the form keeps it local);
              // a tutor signed in to this browser doesn't make it a preview.
              readonly={isTutor && !demo}
              showMarkScheme={isTutor}
            />
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function BackLink() {
  return (
    <Link
      to={isDemoStudent() ? "/demo/student/homework" : "/homework"}
      className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold sm:pointer-fine:min-h-0"
    >
      <ArrowLeft className="size-4" aria-hidden />
      All tasks
    </Link>
  );
}

/** The overall mark, the tutor's comment, and the student's acknowledgement of it. */
function MarkPanel({
  submission,
  readonly,
  onChanged,
}: {
  submission: SubmissionRow;
  readonly: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="tint-emerald premium-card p-5">
      <SectionHeading title="Marked" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {submission.score_pct != null && (
          <span className="chip chip-solid">
            <span className="numeral">{Number(submission.score_pct)}%</span>
          </span>
        )}
        {submission.graded_at && (
          <span className="text-muted-foreground text-xs">
            Marked {plannerDateLabel(new Date(submission.graded_at))}
          </span>
        )}
      </div>

      {submission.feedback && (
        <div className="mt-4">
          <p className="eyebrow-bare">Feedback</p>
          <div className="premium-card mt-2 p-3.5 text-sm leading-relaxed whitespace-pre-wrap">
            <SciText text={submission.feedback} />
          </div>
        </div>
      )}

      {!readonly && <AcknowledgeFeedback submission={submission} onChanged={onChanged} />}
    </div>
  );
}

/**
 * Closes the feedback loop: the student confirms they've read the mark, which
 * notifies the tutor.
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
      <div className="border-border text-muted-foreground mt-4 flex items-center gap-2 border-t pt-3 text-xs">
        <CheckCircle2 className="size-3.5 shrink-0 text-[color:var(--tint)]" />
        You acknowledged this feedback on {plannerDateLabel(new Date(submission.acknowledged_at))}
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
    <div className="border-border mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
      <p className="text-muted-foreground max-w-md text-xs">
        Let your tutor know you&apos;ve read this.
      </p>
      <button
        onClick={acknowledge}
        disabled={saving}
        className="btn-solid inline-flex h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-60 sm:pointer-fine:h-9"
      >
        <CheckCircle2 className="size-4" />
        {saving ? "Acknowledging…" : "Acknowledge"}
      </button>
    </div>
  );
}
