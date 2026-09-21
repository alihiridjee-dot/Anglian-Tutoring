import { createFileRoute, Link } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/routeGuards";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, SegmentedToggle, Spinner, SubjectToggle } from "@/components/Shared";
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
  BUCKET_ORDER,
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

/** Remembers the last subject so the page opens where you left it. */
const SUBJECT_KEY = "homework:subject";

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
  const { enrolledCourses, level, loading: enrolmentsLoading } = useEnrolments();

  // Both queries key off role and enrolled subjects, so hold them until those
  // have settled — querying with a half-known identity would filter wrongly.
  const identityReady = demo || (!rolesLoading && !enrolmentsLoading);

  const { data: homework = [], isPending: homeworkPending } = useHomework({
    isTutor,
    subjects: enrolledCourses,
    level,
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

/**
 * The student's homework list.
 *
 * Two controls narrow what is on screen, mirroring the MCQ page so the pair
 * read as one product: a subject toggle across the top, then the lifecycle as
 * tabs. Previously every lifecycle section was stacked open at once, which was
 * fine at four sheets and unreadable once the planner started writing one per
 * spec point — the practice section alone runs to fifteen.
 *
 * Colour comes from the subject, not the bucket. The buckets used to tint
 * themselves amber/emerald, but a subject toggle that repaints the page cannot
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
  const { enrolledCourses, enrolments } = useEnrolments();
  const [subject, setSubject] = useState<string | null>(null);
  const [bucket, setBucket] = useState<HomeworkBucket>("due");

  // The student sits each subject with one board. A sheet belongs on this page
  // if it is for that board, for every board, or already handed in — switching
  // board must not hide work that has been marked. A subject with no enrolment
  // row (legacy accounts) has nothing to contradict, so nothing is filtered.
  const items: HomeworkItem[] = useMemo(() => {
    const boardOf = new Map(enrolments.map((e) => [e.subject, e.board]));
    return homework
      .map((hw) => ({ hw, submission: submissions[hw.id] }))
      .filter(({ hw, submission }) => {
        const board = boardOf.get(hw.subject);
        return !!submission || !hw.board || !board || hw.board === board;
      });
  }, [homework, submissions, enrolments]);

  // Only the sheets on screen need their question counts, but counting
  // everything at once is still one round trip rather than one per card.
  const { data: summaries = {} } = useHomeworkSummaries(
    items.map((i) => i.hw.id),
    items.length > 0,
  );

  // Only subjects the student sits that actually have homework behind them — a
  // toggle segment that opens an empty page is a dead end.
  const subjects = useMemo(() => {
    const withWork = new Set(items.map((i) => i.hw.subject).filter(Boolean));
    const enrolled = enrolledCourses.filter((s) => withWork.has(s));
    return enrolled.length > 0 ? enrolled : [...withWork].sort();
  }, [items, enrolledCourses]);

  // Settle on a subject once the list is known: the remembered one if it is
  // still on offer, otherwise the first.
  useEffect(() => {
    if (subjects.length === 0 || (subject && subjects.includes(subject))) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(SUBJECT_KEY);
    } catch {
      // Private browsing, or storage refused. Not worth a failure.
    }
    setSubject(remembered && subjects.includes(remembered) ? remembered : subjects[0]);
  }, [subjects, subject]);

  const chooseSubject = (next: string) => {
    setSubject(next);
    try {
      localStorage.setItem(SUBJECT_KEY, next);
    } catch {
      // As above — remembering is a convenience, not a requirement.
    }
  };

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
  }, [sections, bucket]);

  const active = sections.find((s) => s.bucket === bucket) ?? sections[0];
  const nothingAtAll = sections.every((s) => s.items.length === 0);

  return (
    <AppLayout title="Homework & Grades">
      <p className="text-muted-foreground mb-6 max-w-2xl">
        Answer each homework here on the page — nothing to download, nothing to hand in. Your marks
        and feedback appear here once they&apos;ve been checked.
      </p>

      {/* Predicted grades stay a whole-picture summary above the toggle: they
          are the one block on this page that is about comparing subjects, so
          filtering them to the selected one would remove their point. */}
      {analytics.length > 0 && (
        <div data-guide="homework-grades" className="mb-8">
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
      ) : subjects.length === 0 ? (
        <EmptyState
          mascot="star"
          mood="happy"
          title="Nothing due right now"
          body="No homework has been set for your subjects yet. When your tutor posts one it lands here, with the questions and your marks in the same place."
        />
      ) : (
        // The subject tint wraps the page, so the toggle, the tabs and every
        // card and chip inside them are one colour without any of them naming it.
        <div className={SUBJECT_TINT[subject ?? ""] ?? "tint-primary"}>
          <div className="mb-5">
            <SubjectToggle
              subjects={subjects}
              value={subject ?? subjects[0]}
              onChange={chooseSubject}
            />
          </div>

          <div className="mb-5 overflow-x-auto">
            <SegmentedToggle
              layoutId="homework-bucket-pill"
              label="Homework status"
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
              title={`No ${SUBJECT_LABEL[subject ?? ""] ?? ""} homework yet`}
              body="Nothing has been set for this subject so far. It'll appear here as soon as your tutor posts one, or your plan reaches a spec point with a sheet behind it."
            />
          ) : (
            active && (
              <div data-guide="homework-list">
                <p className="text-muted-foreground mb-4 text-xs">{BUCKET_HINT[active.bucket]}</p>
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
