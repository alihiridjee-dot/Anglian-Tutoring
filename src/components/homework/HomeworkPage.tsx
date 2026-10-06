import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, SegmentedToggle, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import {
  useHomework,
  useHomeworkSubmissions,
  useInvalidateHomework,
} from "@/hooks/data/useHomework";
import type { Homework, SubmissionRow } from "@/lib/homework/types";
import { useHomeworkSummaries, type HomeworkSummary } from "@/hooks/data/useHomeworkQuestions";
import {
  BUCKET_LABEL,
  BUCKET_ORDER,
  groupHomework,
  isAwaitingRelease,
  isOverdue,
  type HomeworkBucket,
  type HomeworkItem,
} from "@/lib/homework/homeworkBuckets";
import { ChevronDown, Clock, Plus } from "lucide-react";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { MarkingQueue } from "@/components/tutor/MarkingQueue";
import { HomeworkLibrary } from "@/components/tutor/HomeworkLibrary";
import { HomeworkForm } from "@/components/tutor/HomeworkForm";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { studentBreaksQuery } from "@/lib/planner/breakQueries";
import { plannerDateLabel } from "@/lib/planner/week";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { SUBJECT_LABEL, SUBJECT_TINT, subjectTint } from "@/lib/curriculum/subjectTheme";
import { useEntryState } from "@/hooks/useEntryState";
import { useActiveSubject } from "@/hooks/useActiveSubject";
import { PredictedGradeCard } from "@/components/homework/PredictedGradeCard";

/**
 * The homework list.
 *
 * Deliberately only a list. Answering happens on `/homework/$homeworkId`,
 * because two writers now create homework — a tutor setting a brief, and the
 * planner filling in a sheet for each spec point — and a page that rendered
 * every unsubmitted sheet's form inline stopped being viable the moment the
 * second one existed.
 *
 * Sections are lifecycle states, not sources: due, handed in, marked, then the
 * practice library. See `@/lib/homework/homeworkBuckets` for why that is the right axis.
 */
export function HomeworkPage() {
  const { isTutor, userId, loading: rolesLoading } = useRoles();
  const demo = isDemoStudent();
  const { enrolledCourses, level, loading: enrolmentsLoading } = useEnrolments();

  // Both queries key off role and enrolled subjects, so hold them until those
  // have settled — querying with a half-known identity would filter wrongly.
  const identityReady = demo || (!rolesLoading && !enrolmentsLoading);

  // A tutor's library pages itself (HomeworkLibrary), so only a student's
  // list is read here.
  const { data: homework = [], isPending: homeworkPending } = useHomework({
    isTutor,
    subjects: enrolledCourses,
    level,
    enabled: identityReady && !isTutor,
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
  // the marking queue itself, not a read-only list of briefs. The library of
  // what exists stays available below as secondary context.
  if (isTutor) {
    return (
      <AppLayout title="Tasks & Grades">
        <p className="text-muted-foreground mb-6 max-w-2xl">
          Set tasks as questions students answer on the site — generate them from the spec with AI,
          edit anything, then check the marks before they go out.
        </p>
        {userId && <SetHomeworkPanel userId={userId} />}
        <MarkingQueue />
        {userId && <HomeworkLibrary userId={userId} onChanged={reload} />}
      </AppLayout>
    );
  }

  return (
    <StudentHomework
      homework={homework}
      submissions={submissions}
      loading={loading}
      analytics={analytics}
    />
  );
}

/**
 * The student's homework list.
 *
 * Two controls narrow what is on screen, mirroring the MCQ page so the pair
 * read as one product: the subject from the header slider, then the lifecycle
 * as tabs. Previously every lifecycle section was stacked open at once, which
 * was fine at four sheets and unreadable once the planner started writing one
 * per spec point — the practice section alone runs to fifteen.
 *
 * Colour comes from the subject, not the bucket. The buckets used to tint
 * themselves amber/emerald, but a subject switch that repaints the page cannot
 * share a surface with a second colour system without one of them looking like
 * a bug. Urgency keeps its own signal regardless: overdue still carries a red
 * chip, a mark still carries its score.
 */
function StudentHomework({
  homework,
  submissions,
  loading,
  analytics,
}: {
  homework: Homework[];
  submissions: Record<string, SubmissionRow>;
  loading: boolean;
  analytics: ReturnType<typeof useAnalytics>["rows"];
}) {
  const { enrolments, level } = useEnrolments();
  const { userId } = useRoles();
  const { subject } = useActiveSubject();
  // Kept with the visit, so Back from a task reopens the tab it was on.
  const [bucket, setBucket] = useEntryState<HomeworkBucket>("tasks.tab", "due");
  // A brief due during a break isn't held against them (wasDueOnBreak).
  const { data: breaks } = useQuery({
    ...studentBreaksQuery(userId ?? ""),
    enabled: !!userId && !isDemoStudent(),
  });

  // The student sits each subject with one board. A sheet belongs on this page
  // if it is for that board, for every board, or already handed in — switching
  // board must not hide work that has been marked. A subject with no enrolment
  // row (legacy accounts) has nothing to contradict, so nothing is filtered.
  const items: HomeworkItem[] = useMemo(() => {
    const boardOf = new Map(enrolments.map((e) => [e.subject, e.board]));
    const enrolledAt = new Map(enrolments.map((e) => [e.subject, e.enrolledAt]));
    return homework
      .map((hw) => ({
        hw,
        submission: submissions[hw.id],
        enrolledAt: enrolledAt.get(hw.subject),
        breaks,
      }))
      .filter(({ hw, submission }) => {
        const board = boardOf.get(hw.subject);
        return !!submission || !hw.board || !board || hw.board === board;
      });
  }, [homework, submissions, enrolments, breaks]);

  // Only the sheets on screen need their question counts, but counting
  // everything at once is still one round trip rather than one per card.
  const { data: summaries = {} } = useHomeworkSummaries(
    items.map((i) => i.hw.id),
    items.length > 0,
  );

  // Every bucket, including the empty ones: the tab row keeps its shape as work
  // moves through it, so the tab in a given position is always the same tab.
  const sections = useMemo(() => {
    const mine = subject ? items.filter((i) => i.hw.subject === subject) : items;
    const found = new Map(groupHomework(mine).map((s) => [s.bucket, s.items]));
    return BUCKET_ORDER.map((b) => ({ bucket: b, items: found.get(b) ?? [] }));
  }, [items, subject]);

  // Land on something worth reading. "Due" is the right default when there is
  // anything due, but opening on an empty tab because nothing is would be a
  // worse first impression than simply showing the work that does exist.
  useEffect(() => {
    const current = sections.find((s) => s.bucket === bucket);
    if (current && current.items.length > 0) return;
    const firstWithWork = sections.find((s) => s.items.length > 0);
    if (firstWithWork) setBucket(firstWithWork.bucket);
  }, [sections, bucket, setBucket]);

  const active = sections.find((s) => s.bucket === bucket) ?? sections[0];
  const nothingAtAll = sections.every((s) => s.items.length === 0);

  return (
    <AppLayout title="Tasks & Grades">
      {/* The predicted grade for the subject in the header, against its
          target: just the rings, with no heading or intro above them — the
          slider already names the subject. Keyed by subject so the rings
          draw in again on a switch. Centred on a computer screen, where a
          card this size would otherwise sit in the corner of a wide page. */}
      {subject && (
        <div data-guide="homework-grades" className="mb-8 lg:flex lg:justify-center">
          <PredictedGradeCard
            key={subject}
            subject={subject}
            row={analytics.find((a) => a.subject === subject)}
            level={level}
            targetGrade={enrolments.find((e) => e.subject === subject)?.targetGrade ?? null}
            studentId={isDemoStudent() ? null : userId}
          />
        </div>
      )}

      {loading ? (
        <Spinner label="Fetching your tasks" />
      ) : !subject ? (
        <EmptyState
          mascot="star"
          mood="happy"
          title="Nothing due right now"
          body="No tasks have been set for your subjects yet. When your tutor posts one it lands here, with the questions and your marks in the same place."
        />
      ) : (
        // The subject tint wraps the page, so the tabs and every card and chip
        // inside them are one colour without any of them naming it.
        <div className={subjectTint(subject)}>
          <div className="mb-5 overflow-x-auto">
            <SegmentedToggle
              layoutId="homework-bucket-pill"
              label="Task status"
              value={active?.bucket ?? "due"}
              onChange={(v) => setBucket(v as HomeworkBucket)}
              items={sections.map((s) => ({
                value: s.bucket,
                label: BUCKET_LABEL[s.bucket],
                count: s.items.length,
              }))}
            />
          </div>

          {nothingAtAll ? (
            <EmptyState
              mascot="star"
              mood="happy"
              title={`No ${SUBJECT_LABEL[subject ?? ""] ?? ""} tasks yet`}
              body="Nothing has been set for this subject so far. It'll appear here as soon as your tutor posts one, or your plan reaches a spec point with a sheet behind it."
            />
          ) : (
            active && (
              <div data-guide="homework-list">
                <div className="space-y-3">
                  {active.items.map((item) => (
                    <HomeworkCard key={item.hw.id} item={item} summary={summaries[item.hw.id]} />
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </AppLayout>
  );
}

function HomeworkCard({ item, summary }: { item: HomeworkItem; summary?: HomeworkSummary }) {
  const { hw, submission } = item;
  const overdue = isOverdue(item);
  const awaiting = isAwaitingRelease(item);

  return (
    <Link
      // The showcase mounts the same sheet page under /demo/student, outside the
      // auth guard — linking into the guarded one would bounce a visitor to
      // sign-in from a page whose whole job is to be browsable without an account.
      to={isDemoStudent() ? "/demo/student/homework/$homeworkId" : "/homework/$homeworkId"}
      params={{ homeworkId: hw.id }}
      className={`premium-card flex items-center justify-between gap-4 p-4 transition hover:brightness-[0.99] ${
        SUBJECT_TINT[hw.subject] ?? "tint-primary"
      }`}
    >
      {/* The same shape as the top of the sheet it opens: the title, one plain
          line under it, and a number boxed on the right. No subject label —
          the list only ever holds the subject in the header slider. */}
      <div className="min-w-0">
        <p className="font-display font-bold">{hw.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
          <span>
            {[
              summary && summary.count > 0
                ? `${summary.count} question${summary.count === 1 ? "" : "s"}`
                : null,
              hw.origin === "tutor" ? "Set by your tutor" : "Practice",
              hw.due_at && !submission && !overdue
                ? `Due ${plannerDateLabel(new Date(hw.due_at))}`
                : null,
              awaiting ? "Being marked" : null,
              submission?.graded_at
                ? `Marked ${plannerDateLabel(new Date(submission.graded_at))}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {overdue && hw.due_at && (
            <span className="chip tint-rose inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              Overdue {plannerDateLabel(new Date(hw.due_at))}
            </span>
          )}
        </div>
      </div>

      {/* Once marked, the score is the number that matters, so it takes the
          box in solid tint; until then the box holds the total marks. */}
      {submission?.graded_at && submission.score_pct != null ? (
        <div className="icon-tile icon-tile-solid min-w-16 shrink-0 flex-col px-3 py-2">
          <span className="numeral text-2xl">{Number(submission.score_pct)}%</span>
          <span className="mt-0.5 text-xs font-bold">score</span>
        </div>
      ) : (
        summary &&
        summary.count > 0 && (
          <div className="icon-tile min-w-16 shrink-0 flex-col px-3 py-2">
            <span className="numeral text-2xl">{summary.marks}</span>
            <span className="mt-0.5 text-xs font-bold">mark{summary.marks === 1 ? "" : "s"}</span>
          </div>
        )
      )}
    </Link>
  );
}

/**
 * Set homework straight from the Homework & Grades tab, so a tutor doesn't have
 * to detour through Tutor Studio to post one. Reuses the same form and insert
 * path; taxonomy state is local to the panel.
 */
function SetHomeworkPanel({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<SubjectV>("biology");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [level, setLevel] = useState<LevelV>("gcse");

  return (
    <div className="premium-card mb-8 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Plus className="text-primary size-4" />
          Set a new task
        </span>
        <ChevronDown
          className={`text-muted-foreground size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-border border-t p-5">
          <HomeworkForm
            userId={userId}
            taxonomy={{ subject, setSubject, board, setBoard, level, setLevel }}
          />
        </div>
      )}
    </div>
  );
}
