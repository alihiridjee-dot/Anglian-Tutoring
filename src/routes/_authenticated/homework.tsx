import { createFileRoute, Link } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/routeGuards";
import { useMemo, useState } from "react";
import { EmptyState, SectionHeading, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import {
  useHomework,
  useHomeworkSubmissions,
  useInvalidateHomework,
  type Homework,
  type SubmissionRow,
} from "@/hooks/data/useHomework";
import { useHomeworkSummaries, type HomeworkSummary } from "@/hooks/data/useHomeworkQuestions";
import {
  BUCKET_HINT,
  BUCKET_LABEL,
  BUCKET_TINT,
  groupHomework,
  isAwaitingRelease,
  isOverdue,
  type HomeworkBucket,
  type HomeworkItem,
} from "@/lib/homeworkBuckets";
import { ChevronDown, ChevronRight, Clock, Plus, TrendingUp } from "lucide-react";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { MarkingQueue } from "@/components/tutor/MarkingQueue";
import { HomeworkLibrary } from "@/components/tutor/HomeworkLibrary";
import { HomeworkForm } from "@/components/tutor/HomeworkForm";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { SUBJECT_LABEL, SUBJECT_TINT } from "@/lib/subjectTheme";

export const Route = createFileRoute("/_authenticated/homework")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Homework & Grades | Anglia Educate" }] }),
  component: HomeworkPage,
});

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
 * practice library. See `@/lib/homeworkBuckets` for why that is the right axis.
 */
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
  // the marking queue itself, not a read-only list of briefs. The library of
  // what exists stays available below as secondary context.
  if (isTutor) {
    return (
      <AppLayout title="Homework & Grades">
        <p className="text-muted-foreground mb-6 max-w-2xl">
          Set homework as questions students answer on the site — generate them from the spec with
          AI, edit anything, then check the marks before they go out.
        </p>
        {userId && <SetHomeworkPanel userId={userId} />}
        <MarkingQueue />
        {userId && (
          <HomeworkLibrary
            homework={homework}
            loading={loading}
            userId={userId}
            onChanged={reload}
          />
        )}
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
  const items: HomeworkItem[] = useMemo(
    () => homework.map((hw) => ({ hw, submission: submissions[hw.id] })),
    [homework, submissions],
  );
  const sections = useMemo(() => groupHomework(items), [items]);

  // Only the sheets on screen need their question counts, and the practice
  // section is collapsed by default — but it is also the biggest, so counting
  // everything at once is still one round trip rather than one per card.
  const { data: summaries = {} } = useHomeworkSummaries(
    homework.map((h) => h.id),
    homework.length > 0,
  );

  return (
    <AppLayout title="Homework & Grades">
      <p className="text-muted-foreground mb-6 max-w-2xl">
        Answer each homework here on the page — nothing to download, nothing to hand in. Your marks
        and feedback appear here once they&apos;ve been checked.
      </p>

      {/* Predicted grades live in the homework section. */}
      {analytics.length > 0 && (
        <div className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="text-primary size-4" />
            <h3 className="text-base">Predicted Grades</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {analytics.map((a) => (
              <div
                key={a.subject}
                className={`premium-card p-5 ${SUBJECT_TINT[a.subject] ?? "tint-primary"}`}
              >
                <p className="eyebrow-bare">{SUBJECT_LABEL[a.subject] ?? a.subject}</p>
                <p className="numeral mt-1 text-2xl text-[color:var(--tint)]">
                  Grade {a.predictedGrade}
                </p>
                <div className="border-border text-muted-foreground mt-3 flex items-center justify-between border-t pt-3 text-[11px]">
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
        <Spinner label="Fetching your homework" />
      ) : sections.length === 0 ? (
        <EmptyState
          mascot="star"
          mood="happy"
          title="Nothing due right now"
          body="No homework has been set for your subjects yet. When your tutor posts one it lands here, with the questions and your marks in the same place."
        />
      ) : (
        <div className="space-y-8">
          {sections.map((section) => (
            <HomeworkSection
              key={section.bucket}
              bucket={section.bucket}
              items={section.items}
              summaries={summaries}
            />
          ))}
        </div>
      )}
    </AppLayout>
  );
}

/**
 * One lifecycle section.
 *
 * Practice starts collapsed. It is the section that grows without bound — one
 * sheet for every spec point the student's plan has ever touched — and left
 * open it would bury the three sections that actually need attention under a
 * scrolling wall of topics.
 */
function HomeworkSection({
  bucket,
  items,
  summaries,
}: {
  bucket: HomeworkBucket;
  items: HomeworkItem[];
  summaries: Record<string, HomeworkSummary>;
}) {
  const [open, setOpen] = useState(bucket !== "practice");

  return (
    <section className={BUCKET_TINT[bucket]}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <SectionHeading
            title={`${BUCKET_LABEL[bucket]} (${items.length})`}
            hint={BUCKET_HINT[bucket]}
          />
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <HomeworkCard key={item.hw.id} item={item} summary={summaries[item.hw.id]} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One sheet, as a row you press.
 *
 * Everything on it answers "should I open this?" — what it is, how big it is,
 * and where it has got to. What the questions actually say is a page away,
 * which is the whole point.
 */
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
      className={`premium-card block p-4 transition hover:brightness-[0.99] ${
        SUBJECT_TINT[hw.subject] ?? "tint-primary"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip">{SUBJECT_LABEL[hw.subject] ?? hw.subject}</span>
        {hw.origin === "tutor" && <span className="chip">Set by your tutor</span>}
        {overdue && <span className="chip tint-rose">Overdue</span>}
        {submission?.graded_at && submission.score_pct != null && (
          <span className="chip-solid">
            <span className="numeral">{Number(submission.score_pct)}%</span>
          </span>
        )}
      </div>

      <p className="font-display mt-2 font-bold">{hw.title}</p>

      <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {summary && summary.count > 0 && (
          <span>
            {summary.count} question{summary.count === 1 ? "" : "s"} · {summary.marks} marks
          </span>
        )}
        {hw.due_at && !submission && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            Due {new Date(hw.due_at).toLocaleDateString()}
          </span>
        )}
        {awaiting && <span>Being marked</span>}
        {submission?.graded_at && (
          <span>Marked {new Date(submission.graded_at).toLocaleDateString()}</span>
        )}
      </div>
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
          Set new homework
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
