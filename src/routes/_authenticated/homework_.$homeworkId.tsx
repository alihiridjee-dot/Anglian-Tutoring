import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppLayout } from "@/components/AppLayout";
import { AwaitingMark, BuiltInHomework } from "@/components/BuiltInHomework";
import { EmptyState, ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { useHomeworkSheet, useInvalidateHomework } from "@/hooks/data/useHomework";
import type { SubmissionRow } from "@/hooks/data/useHomework";
import { useRoles } from "@/hooks/useRole";
import { acknowledgeSubmission } from "@/lib/homework.functions";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { SUBJECT_LABEL, SUBJECT_TINT } from "@/lib/subjectTheme";
import { guardStudentSection } from "@/lib/routeGuards";

/**
 * One homework sheet, on its own page.
 *
 * The list used to render every unsubmitted brief's answer form inline, which
 * was fine at four briefs and untenable once the planner started writing a
 * sheet per spec point: a student with twenty of them met a page holding a
 * hundred textareas, all mounted, all autosaving. Splitting the doing from the
 * choosing fixes that, and gives the planner's homework chips somewhere to
 * point — they had been dropping every student on the same undifferentiated
 * list and leaving them to find the right row.
 *
 * A tutor gets the same page read-only, mark schemes included. That is the
 * preview the tutor side never had: until now the only way to see what you had
 * set was to be a student who had been set it.
 */
export const Route = createFileRoute("/_authenticated/homework_/$homeworkId")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Homework | Anglia Educate" }] }),
  component: HomeworkSheetPage,
});

export function HomeworkSheetPage() {
  // `strict: false` because this component is mounted twice — here, and again
  // under /demo/student for the signed-out showcase. Binding the params to one
  // route id would make it readable from only one of them.
  const params = useParams({ strict: false }) as { homeworkId?: string };
  const homeworkId = params.homeworkId ?? "";
  const { isTutor, userId, loading: rolesLoading } = useRoles();
  const demo = isDemoStudent();
  const reload = useInvalidateHomework();

  const { data, isPending, error } = useHomeworkSheet({
    homeworkId,
    // A tutor is previewing, not answering, so they carry no submission into
    // the query and get the blank paper.
    userId: isTutor ? null : userId,
    enabled: demo || !rolesLoading,
  });

  if (!demo && rolesLoading)
    return (
      <AppLayout title="Homework">
        <Spinner label="Loading" />
      </AppLayout>
    );

  if (error) {
    return (
      <AppLayout title="Homework">
        <BackLink />
        <div className="mt-6">
          <ErrorNote error={error} />
        </div>
      </AppLayout>
    );
  }

  if (isPending || !data) {
    return (
      <AppLayout title="Homework">
        <BackLink />
        <Spinner label="Opening this homework" />
      </AppLayout>
    );
  }

  const { hw, questions, submission, answers } = data;
  const marked = !!submission?.graded_at;
  const overdue = !submission && hw.due_at && new Date(hw.due_at) < new Date();

  return (
    <AppLayout title={hw.title}>
      <div className={SUBJECT_TINT[hw.subject] ?? "tint-primary"}>
        <BackLink />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="chip">{SUBJECT_LABEL[hw.subject] ?? hw.subject}</span>
          <span className="chip">{hw.origin === "tutor" ? "Set by your tutor" : "Practice"}</span>
          {/* A deadline is only news while it can still be missed. Once the work
              is in, "Due 3rd September" beside a mark reads as a reproach for
              something the student already did. */}
          {hw.due_at && !submission && (
            <span className={`chip ${overdue ? "tint-rose" : ""} inline-flex items-center gap-1`}>
              <Clock className="size-3" aria-hidden />
              {overdue ? "Overdue" : "Due"} {new Date(hw.due_at).toLocaleDateString()}
            </span>
          )}
          {questions.length > 0 && (
            <span className="text-muted-foreground text-xs">
              {questions.length} question{questions.length === 1 ? "" : "s"} ·{" "}
              {questions.reduce((sum, q) => sum + q.marks, 0)} marks
            </span>
          )}
        </div>

        <h1 className="font-display mt-3 text-2xl font-extrabold sm:text-3xl">{hw.title}</h1>

        {hw.instructions && (
          <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-relaxed whitespace-pre-wrap">
            {hw.instructions}
          </p>
        )}

        {isTutor && (
          <p className="premium-card text-muted-foreground mt-5 p-4 text-sm">
            This is the sheet as a student sees it, with the mark schemes shown. Marking happens in
            the queue on the{" "}
            <Link to="/homework" className="font-semibold underline">
              Homework &amp; Grades
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
              body="This homework has no questions on it yet. Your tutor may still be putting it together — check back, or ask them about it."
            />
          ) : (
            <BuiltInHomework
              hw={hw}
              questions={questions}
              userId={userId}
              submission={submission ?? undefined}
              answers={answers}
              onChanged={reload}
              readonly={demo || isTutor}
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
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-semibold"
    >
      <ArrowLeft className="size-4" aria-hidden />
      All homework
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
          <span className="chip-solid">
            <span className="numeral">{Number(submission.score_pct)}%</span>
          </span>
        )}
        {submission.graded_at && (
          <span className="text-muted-foreground text-xs">
            Marked {new Date(submission.graded_at).toLocaleDateString()}
          </span>
        )}
      </div>

      {submission.feedback && (
        <div className="mt-4">
          <p className="eyebrow-bare">Feedback</p>
          <div className="premium-card mt-2 p-3.5 text-sm leading-relaxed whitespace-pre-wrap">
            {submission.feedback}
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
    <div className="border-border mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
      <p className="text-muted-foreground max-w-md text-xs">
        Let your tutor know you&apos;ve read this.
      </p>
      <button
        onClick={acknowledge}
        disabled={saving}
        className="btn-solid inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-60"
      >
        <CheckCircle2 className="size-4" />
        {saving ? "Acknowledging…" : "Acknowledge"}
      </button>
    </div>
  );
}
