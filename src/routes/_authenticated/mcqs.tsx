import { createFileRoute, Link } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/routeGuards";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorNote, SectionHeading, Spinner, SubjectToggle } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight, ChevronDown, CalendarClock, CheckCircle2 } from "lucide-react";
import { isDemoStudent, DEMO_MCQ, DEMO_MCQ_ATTEMPTS, DEMO_MCQ_SETS } from "@/lib/demo/studentDemo";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { McqManager } from "@/components/tutor/McqManager";
import { SUBJECT_TINT, subjectLabel } from "@/lib/subjectTheme";
import { currentWeekKey, plannerDateLabel, weekRangeLabel, mondayOf } from "@/lib/week";

export const Route = createFileRoute("/_authenticated/mcqs")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "MCQs | Anglia Educate" }] }),
  component: MCQs,
});

/** One quiz, with everything the list needs to place it and describe it. */
type QuizSet = {
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  subject: string | null;
  specPointId: string | null;
  specCode: string | null;
  topicId: string | null;
  topicTitle: string | null;
  topicSort: number;
  questionCount: number;
};

/** The student's best attempt at a set, or nothing if they've never opened it. */
type Attempt = { score: number; total: number };

/** Remembers the last subject so the page opens where you left it. */
const SUBJECT_KEY = "mcqs:subject";

export function MCQs() {
  const { isTutor, loading: rolesLoading } = useRoles();

  // Same route, different view: a tutor gets a management console (publish,
  // preview, delete), a student gets the take-a-quiz experience below. Mirrors
  // how Homework & Grades branches its page on role.
  if (rolesLoading) {
    return (
      <AppLayout title="Weekly MCQs">
        <Spinner />
      </AppLayout>
    );
  }
  if (isTutor) {
    return (
      <AppLayout title="Weekly MCQs">
        <McqManager />
      </AppLayout>
    );
  }
  return <StudentMCQs />;
}

/**
 * The student's quiz list.
 *
 * Three decisions carry this page, and they are all about narrowing what is on
 * screen at once:
 *
 * 1. **One subject at a time.** Every quiz used to sit in one scroll, so a
 *    student revising Chemistry had to read past Biology to find it. The
 *    toggle picks the subject and the whole page repaints to its colour.
 * 2. **This week is defined by the plan, not by a due date.** Sets are written
 *    per spec point and carry no deadline — `due_at` is null on every one in
 *    production — so "this week" reads the student's own weekly plan and asks
 *    which points they are on right now. It follows the plan forward with no
 *    tutor action.
 * 3. **Everything else is filed under its topic, collapsed.** The archive grows
 *    without bound; left flat it buries the handful of quizzes that matter.
 */
function StudentMCQs() {
  const { enrolledCourses, loading: enrolmentsLoading } = useEnrolments();
  const [sets, setSets] = useState<QuizSet[]>([]);
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});
  /** spec point id → the Monday of the week the student is scheduled to do it. */
  const [weekByPoint, setWeekByPoint] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);

  const thisWeek = currentWeekKey();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The showcase has no session, so it renders fixtures and nothing else —
      // no read of `mcq_sets`, no attempts, and nothing that could reach quiz
      // generation. Each fixture says whether it is on this week's plan.
      if (isDemoStudent()) {
        if (cancelled) return;
        setSets(
          DEMO_MCQ_SETS.map((s) => ({
            id: s.id,
            title: s.title,
            published: s.published,
            created_at: s.created_at,
            subject: s.subject,
            specPointId: s.id,
            specCode: s.specPoint,
            topicId: s.topic,
            topicTitle: s.topic,
            topicSort: s.topicSort,
            questionCount: DEMO_MCQ[s.id]?.questions.length ?? 0,
          })),
        );
        setWeekByPoint(
          Object.fromEntries(
            DEMO_MCQ_SETS.filter((s) => s.thisWeek).map((s) => [s.id, currentWeekKey()]),
          ),
        );
        setAttempts(DEMO_MCQ_ATTEMPTS);
        setLoading(false);
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;

      const [
        { data: rows, error: setsError },
        { data: planned, error: plannedError },
        { data: attemptRows },
      ] = await Promise.all([
        // The topic comes through the spec point — `mcq_sets` has no topic
        // column of its own, and the heading a student scans by is the topic's.
        //
        // Deliberately no `mcq_questions(count)` here. A student's grant on
        // `mcq_questions` is column-level — question, options, position, but
        // never `correct_index` or `explanation` — and an aggregate needs SELECT
        // on the whole table, so asking for one 403s the entire query and empties
        // the page. The counts come from a granted column below instead; the
        // answers stay unreadable, which is the point of marking server-side.
        supabase
          .from("mcq_sets")
          .select(
            "id, title, published, created_at, origin, spec_point_id, subject, spec_points(code, topics(id, title, sort_order, subject))",
          )
          .order("created_at", { ascending: false }),
        uid
          ? supabase
              .from("student_weekly_plan_points")
              .select("spec_point_id, student_weekly_plans!inner(student_id, week_start)")
              .eq("student_weekly_plans.student_id", uid)
          : Promise.resolve({ data: [] as PlanPointRow[], error: null }),
        uid
          ? supabase.from("mcq_attempts").select("set_id, score, total").eq("user_id", uid)
          : Promise.resolve({ data: [] as AttemptRow[] }),
      ]);
      if (cancelled) return;

      // A failed read is not an empty shelf. Swallowing an error here is what
      // turned a 403 into a confident "No quizzes yet" on a page whose quizzes
      // all existed, so both reads that can empty the page are checked: the
      // sets themselves, and the plan that decides which of them are this
      // student's. A failed plan read leaves every generated set filtered out,
      // which looks exactly like having no quizzes and is not the same thing.
      const fatal = setsError ?? plannedError;
      if (fatal) {
        setLoadError(fatal.message);
        setLoading(false);
        return;
      }

      // A point can be planned more than once (it gets carried, or revisited).
      // The latest week is the one that decides whether it is current, so a
      // point carried into this week counts as this week's work.
      const weeks: Record<string, string> = {};
      for (const p of (planned ?? []) as unknown as PlanPointRow[]) {
        const week = p.student_weekly_plans?.week_start;
        if (!p.spec_point_id || !week) continue;
        if (!weeks[p.spec_point_id] || week > weeks[p.spec_point_id]) {
          weeks[p.spec_point_id] = week;
        }
      }
      setWeekByPoint(weeks);

      const mine = new Set(Object.keys(weeks));
      const visible = ((rows ?? []) as unknown as SetQueryRow[])
        // Shared sets are written for every spec point any student reaches,
        // across every board, so a student sees only those for points that
        // have appeared in one of their own weeks.
        .filter((r) => r.origin !== "generated" || (!!r.spec_point_id && mine.has(r.spec_point_id)))
        .map((r) => ({
          id: r.id,
          title: r.title,
          published: r.published,
          created_at: r.created_at,
          subject: r.subject ?? r.spec_points?.topics?.subject ?? null,
          specPointId: r.spec_point_id,
          specCode: r.spec_points?.code ?? null,
          topicId: r.spec_points?.topics?.id ?? null,
          topicTitle: r.spec_points?.topics?.title ?? null,
          topicSort: r.spec_points?.topics?.sort_order ?? 0,
          questionCount: 0,
        }));

      // How long each quiz is, counted from `set_id` — a column a student is
      // granted — rather than from an aggregate they are not. A failure here
      // costs the card its "12 questions" line and nothing else, so it is
      // deliberately not allowed to fail the page.
      if (visible.length > 0) {
        const { data: qRows } = await supabase
          .from("mcq_questions")
          .select("set_id")
          .in(
            "set_id",
            visible.map((s) => s.id),
          );
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const q of (qRows ?? []) as { set_id: string }[]) {
          counts.set(q.set_id, (counts.get(q.set_id) ?? 0) + 1);
        }
        for (const s of visible) s.questionCount = counts.get(s.id) ?? 0;
      }
      setSets(visible);

      // Best attempt per set — a retake that went worse shouldn't replace a
      // good score on the card.
      const best: Record<string, Attempt> = {};
      for (const a of (attemptRows ?? []) as unknown as AttemptRow[]) {
        const prev = best[a.set_id];
        if (!prev || a.score / Math.max(a.total, 1) > prev.score / Math.max(prev.total, 1)) {
          best[a.set_id] = { score: a.score, total: a.total };
        }
      }
      setAttempts(best);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Only subjects the student actually sits, and only those with quizzes behind
  // them — a toggle segment that opens an empty page is a dead end.
  const subjects = useMemo(() => {
    const withQuizzes = new Set(sets.map((s) => s.subject).filter(Boolean) as string[]);
    const enrolled = enrolledCourses.filter((s) => withQuizzes.has(s));
    // Fall back to whatever the quizzes say if enrolment hasn't loaded or
    // doesn't overlap, so the page is never blank for want of a profile row.
    return enrolled.length > 0 ? enrolled : [...withQuizzes].sort();
  }, [sets, enrolledCourses]);

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

  // This week's work, and everything else filed under its topic.
  const { current, byTopic } = useMemo(() => {
    const mine = sets.filter((s) => s.subject === subject);
    const current: QuizSet[] = [];
    const past: QuizSet[] = [];
    for (const s of mine) {
      const week = s.specPointId ? weekByPoint[s.specPointId] : undefined;
      if (week === thisWeek) current.push(s);
      else past.push(s);
    }

    const groups = new Map<string, { title: string; sort: number; items: QuizSet[] }>();
    for (const s of past) {
      const key = s.topicId ?? "untopiced";
      if (!groups.has(key)) {
        groups.set(key, {
          title: s.topicTitle ?? "Other practice",
          sort: s.topicSort,
          items: [],
        });
      }
      groups.get(key)!.items.push(s);
    }
    const byTopic = [...groups.values()].sort(
      (a, b) => a.sort - b.sort || a.title.localeCompare(b.title),
    );
    return { current, byTopic };
  }, [sets, subject, weekByPoint, thisWeek]);

  const pageLoading = loading || enrolmentsLoading;

  return (
    <AppLayout title="Weekly MCQs">
      <p className="text-muted-foreground mb-6 max-w-2xl">
        Multiple-choice quizzes built from your exam spec. Each one marks itself the moment you
        submit, with a worked explanation on every question.
      </p>

      {pageLoading ? (
        <Spinner label="Loading your quizzes" />
      ) : loadError ? (
        <ErrorNote error={loadError} />
      ) : subjects.length === 0 ? (
        <EmptyState
          mascot="pencil"
          mood="sleepy"
          title="No quizzes yet"
          body="Nothing has been set for your subjects so far. Ask your tutor to generate one for this week — quizzes are the quickest way to find the spec points you haven't nailed yet."
        />
      ) : (
        // The subject tint wraps the whole page, so the toggle, the cards and
        // every chip inside them are one colour without any of them naming it.
        <div className={SUBJECT_TINT[subject ?? ""] ?? "tint-primary"}>
          <div className="mb-8">
            <SubjectToggle
              subjects={subjects}
              value={subject ?? subjects[0]}
              onChange={chooseSubject}
            />
          </div>

          <ThisWeek sets={current} attempts={attempts} />

          {byTopic.length > 0 && (
            <div className="mt-10">
              <SectionHeading
                title="Past MCQs"
                hint="Everything you've covered before this week, filed by topic."
              />
              <div className="mt-4 space-y-3">
                {byTopic.map((group) => (
                  <TopicGroup
                    key={group.title}
                    title={group.title}
                    items={group.items}
                    attempts={attempts}
                  />
                ))}
              </div>
            </div>
          )}

          {current.length === 0 && byTopic.length === 0 && (
            <EmptyState
              mascot="pencil"
              mood="sleepy"
              title={`No ${subjectLabel(subject ?? "")} quizzes yet`}
              body="Nothing has been written for this subject so far. It'll appear here as soon as your plan reaches a spec point with a quiz behind it."
            />
          )}
        </div>
      )}
    </AppLayout>
  );
}

/** The week's own section — the reason to open the page at all. */
function ThisWeek({ sets, attempts }: { sets: QuizSet[]; attempts: Record<string, Attempt> }) {
  const done = sets.filter((s) => attempts[s.id]).length;

  return (
    <section className="surface-loud p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="icon-tile size-9 rounded-xl">
            <CalendarClock className="size-4 text-[color:var(--tint)]" aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-lg font-extrabold">This week</h2>
            <p className="text-muted-foreground text-xs">{weekRangeLabel(mondayOf())}</p>
          </div>
        </div>
        {/* The status is the whole message when there is nothing to list: a week
            with no quizzes gets a chip, not a panel explaining its own
            emptiness. */}
        <span className="chip">
          {sets.length === 0 ? (
            "Nothing set"
          ) : (
            <>
              <span className="numeral">
                {done}/{sets.length}
              </span>
              done
            </>
          )}
        </span>
      </div>

      {sets.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sets.map((s) => (
            <QuizCard key={s.id} set={s} attempt={attempts[s.id]} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One topic's archive, collapsed.
 *
 * Closed by default and deliberately so: the point of the split is that a
 * student scans a short list of topic names rather than a long list of quizzes.
 */
function TopicGroup({
  title,
  items,
  attempts,
}: {
  title: string;
  items: QuizSet[];
  attempts: Record<string, Attempt>;
}) {
  const [open, setOpen] = useState(false);
  const done = items.filter((s) => attempts[s.id]).length;

  return (
    <div className="premium-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-3.5 text-left transition"
      >
        <ChevronDown
          className={`text-muted-foreground size-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        />
        <span className="font-display min-w-0 flex-1 truncate font-bold">{title}</span>
        {done === items.length && (
          <CheckCircle2 className="size-4 shrink-0 text-[color:var(--tint)]" aria-hidden />
        )}
        <span className="chip shrink-0">
          <span className="numeral">
            {done}/{items.length}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-border grid grid-cols-1 gap-3 border-t p-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <QuizCard key={s.id} set={s} attempt={attempts[s.id]} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One quiz, as a card you press.
 *
 * Everything on it answers "should I open this?" — what it covers, how long it
 * is, and how you did last time. Built from the kit so a Biology quiz card and
 * a Biology homework card are recognisably the same object.
 */
function QuizCard({ set, attempt }: { set: QuizSet; attempt?: Attempt }) {
  const pct =
    attempt && attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : null;

  return (
    <Link
      // The showcase mounts the same quiz page under /demo/student, outside the
      // auth guard — linking into the guarded one would bounce a visitor to
      // sign-in from a page whose whole job is to be browsable without an account.
      to={isDemoStudent() ? "/demo/student/mcq/$setId" : "/mcq/$setId"}
      params={{ setId: set.id }}
      className="premium-card premium-card-interactive group flex flex-col p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        {set.specCode && <span className="chip">{set.specCode}</span>}
        {!set.published && <span className="chip tint-slate">Draft</span>}
        {pct !== null && (
          <span className="chip-solid">
            <span className="numeral">{pct}%</span>
          </span>
        )}
      </div>

      <p className="font-display mt-2 flex-1 font-bold leading-snug">{set.title}</p>

      <div className="text-muted-foreground mt-3 flex items-center justify-between gap-2 text-xs">
        <span>
          {set.questionCount > 0
            ? `${set.questionCount} question${set.questionCount === 1 ? "" : "s"}`
            : plannerDateLabel(new Date(set.created_at))}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-[color:var(--tint)]">
          {attempt ? "Review" : "Start"}
          <ChevronRight
            className="size-3 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}

/* ── Shapes the queries come back in ──────────────────────────────────────── */

type PlanPointRow = {
  spec_point_id: string;
  student_weekly_plans: { week_start: string } | null;
};

type AttemptRow = { set_id: string; score: number; total: number };

type SetQueryRow = {
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  origin: string;
  spec_point_id: string | null;
  subject: string | null;
  spec_points: {
    code: string | null;
    topics: { id: string; title: string; sort_order: number; subject: string } | null;
  } | null;
};
