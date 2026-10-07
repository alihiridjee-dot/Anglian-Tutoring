import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorNote, SegmentedToggle, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight } from "lucide-react";
import { isDemoStudent, DEMO_MCQ, DEMO_MCQ_ATTEMPTS, DEMO_MCQ_SETS } from "@/lib/demo/studentDemo";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useActiveSubject } from "@/hooks/useActiveSubject";
import { useEntryState } from "@/hooks/useEntryState";
import { McqManager } from "@/components/tutor/McqManager";
import { SUBJECT_TINT, subjectLabel } from "@/lib/curriculum/subjectTheme";
import { selectIn, selectInHistory } from "@/lib/platform/db/chunked";
import { plannerDateLabel } from "@/lib/planner/week";
import { practiceInWeek } from "@/lib/planner/coverage";
import { DUE_LANE_ORDER, type DueSlot } from "@/lib/planner/dueLanes";
import { retakeOpensAt } from "@/lib/mcq/retakeLock";
import { useDueThisWeek } from "@/components/planner/useDueThisWeek";
import { DueLanes, DueSection } from "@/components/planner/DueSection";
import { MarkedTopic } from "@/components/planner/MarkedTopic";
import { groupUnderTopics, noTopic, type TopicRef } from "@/lib/curriculum/topicGroups";

/** One quiz, with everything the list needs to place it and describe it. */
type QuizSet = {
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  subject: string | null;
  specPointId: string | null;
  specCode: string | null;
  /** The course topic its spec point sits in, which Marked files it under. */
  topic: TopicRef | null;
  questionCount: number;
};

/** The student's best attempt at a set, or nothing if they've never opened it. */
type Attempt = {
  score: number;
  total: number;
  /** When the latest attempt's week is up (see retakeLock). Absent on the showcase. */
  opensAt?: Date;
  /** When they last took it. Absent on the showcase, where every attempt is this week's. */
  lastAt?: string;
};

/** The page's two tabs: the week's quizzes still to do, and every quiz already done. */
type McqTab = "due" | "marked";

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
 * The student's quiz list, built the way Tasks & Grades is so the pair read as
 * one product.
 *
 * 1. **One subject at a time.** The header slider picks the subject and the
 *    whole page repaints to its colour.
 * 2. **Due is this week's plan.** Tutors don't assign quizzes: every set is the
 *    shared one for a spec point, with no deadline. So Due is the quizzes on
 *    this week's points that haven't been taken this week, split into the
 *    dashboard's lanes ({@link useDueThisWeek}) — the same names, in the same
 *    order, as the dashboard and the Tasks page.
 * 3. **Done moves to Marked.** A quiz marks itself, so there is no "handed in"
 *    step: taking it moves it to Marked with its best score, filed under its
 *    topic as Tasks' Marked is (see `MarkedTopic`). That replaced "Past MCQs",
 *    every reached quiz filed by topic, which read as optional extras beside a
 *    week that was mostly the same quizzes.
 */
function StudentMCQs() {
  const { loading: enrolmentsLoading } = useEnrolments();
  const { subject } = useActiveSubject();
  const due = useDueThisWeek(subject);
  const [sets, setSets] = useState<QuizSet[]>([]);
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Kept with the visit, so Back from a quiz reopens the tab it was on.
  const [tab, setTab] = useEntryState<McqTab>("mcqs.tab", "due");

  // This week's quizzes for the subject on screen. They are read by id, so a
  // new subject's week — or a quiz the practice queue has just written — is
  // read again rather than looked for in a list that never held it.
  const dueKey = [...due.slots.quizzes.keys()].sort().join(",");
  /** The due list the quizzes on screen were read for; behind `dueKey` while a read is under way. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    // The week decides what is due, so wait for it.
    if (due.loading) return;
    let cancelled = false;
    /** Ends this read, with or without quizzes, so the page stops waiting on it. */
    const settle = (error: string | null = null) => {
      setLoadError(error);
      setLoadedKey(dueKey);
      setLoading(false);
    };
    (async () => {
      // The showcase has no session, so it renders fixtures and nothing else —
      // no read of `mcq_sets`, no attempts, and nothing that could reach quiz
      // generation. Its week (`demoWeek`) says which are due.
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
            // The showcase names its topics but doesn't number them.
            topic: { id: s.topic, title: s.topic, order: 0 },
            questionCount: DEMO_MCQ[s.id]?.questions.length ?? 0,
          })),
        );
        setAttempts(DEMO_MCQ_ATTEMPTS);
        settle();
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      if (cancelled) return;
      const uid = auth?.user?.id;
      if (!uid) {
        settle();
        return;
      }

      const { data: attemptRows, error: attemptsError } = await supabase
        .from("mcq_attempts")
        .select("set_id, score, total, created_at")
        .eq("user_id", uid);
      if (cancelled) return;
      // A failed read is not an empty shelf. Swallowing an error here is what
      // turned a 403 into a confident "No quizzes yet" on a page whose quizzes
      // all existed.
      if (attemptsError) {
        settle(attemptsError.message);
        return;
      }
      const taken = (attemptRows ?? []) as unknown as AttemptRow[];

      // Only the sets the page can show: those taken (Marked) and this week's
      // (Due). Asked of the database by id rather than fetched whole and
      // filtered here: the library holds a set for every point any student on
      // any board has reached, which both outgrows a single page of rows and
      // was letting another course's quizzes through wherever a filter missed.
      const wanted = [
        ...new Set([...taken.map((a) => a.set_id), ...(dueKey ? dueKey.split(",") : [])]),
      ];
      let rows: SetQueryRow[];
      try {
        rows = await selectIn<SetQueryRow>(wanted, (batch) =>
          supabase
            .from("mcq_sets")
            .select(
              "id, title, published, created_at, spec_point_id, subject, spec_points(code, topics(id, title, sort_order, subject))",
            )
            .in("id", batch),
        );
      } catch (e) {
        if (cancelled) return;
        settle(e instanceof Error ? e.message : "Couldn't load your quizzes.");
        return;
      }
      if (cancelled) return;

      const visible = rows
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((r) => ({
          id: r.id,
          title: r.title,
          published: r.published,
          created_at: r.created_at,
          subject: r.subject ?? r.spec_points?.topics?.subject ?? null,
          specPointId: r.spec_point_id,
          specCode: r.spec_points?.code ?? null,
          topic: r.spec_points?.topics
            ? {
                id: r.spec_points.topics.id,
                title: r.spec_points.topics.title,
                order: r.spec_points.topics.sort_order,
              }
            : null,
          questionCount: 0,
        }));

      // How long each quiz is, counted from `set_id` — a column a student is
      // granted — rather than from an aggregate they are not. Paged, because a
      // year of points at eight questions a set is more rows than one response
      // carries. A failure here costs the card its "8 questions" line and
      // nothing else, so it is deliberately not allowed to fail the page.
      if (visible.length > 0) {
        try {
          const qRows = await selectInHistory<{ id: string; set_id: string }>(
            visible.map((s) => s.id),
            (batch, after) => {
              const query = supabase
                .from("mcq_questions")
                .select("id, set_id")
                .in("set_id", batch)
                .order("id")
                .limit(500);
              return after ? query.gt("id", after) : query;
            },
          );
          if (cancelled) return;
          const counts = new Map<string, number>();
          for (const q of qRows) counts.set(q.set_id, (counts.get(q.set_id) ?? 0) + 1);
          for (const s of visible) s.questionCount = counts.get(s.id) ?? 0;
        } catch {
          // Counts are decoration; the quizzes themselves have loaded.
        }
      }
      setSets(visible);

      // Best attempt per set — a retake that went worse shouldn't replace a
      // good score on the card.
      const best: Record<string, Attempt> = {};
      const latest: Record<string, string> = {};
      for (const a of taken) {
        const prev = best[a.set_id];
        if (!prev || a.score / Math.max(a.total, 1) > prev.score / Math.max(prev.total, 1)) {
          best[a.set_id] = { score: a.score, total: a.total };
        }
        if (!latest[a.set_id] || a.created_at > latest[a.set_id]) latest[a.set_id] = a.created_at;
      }
      for (const [setId, at] of Object.entries(latest)) {
        best[setId].opensAt = retakeOpensAt(at);
        best[setId].lastAt = at;
      }
      setAttempts(best);
      settle();
    })();

    return () => {
      cancelled = true;
    };
  }, [due.loading, dueKey]);

  // Due: this week's quizzes not yet taken this week, in the week's order. A
  // revision quiz taken in an earlier week is due again — that is what revision
  // is. Marked: every quiz taken, filed under its topic below.
  const { dueByLane, marked } = useMemo(() => {
    const mine = sets.filter((s) => s.subject === subject);
    const dueSets: Array<{ set: QuizSet; slot: DueSlot }> = [];
    const marked: QuizSet[] = [];
    for (const s of mine) {
      const slot = due.slots.quizzes.get(s.id);
      const a = attempts[s.id];
      const takenThisWeek = !!a && (!a.lastAt || practiceInWeek(a.lastAt, due.weekStart));
      if (slot && !takenThisWeek) dueSets.push({ set: s, slot });
      else if (a) marked.push(s);
    }
    dueSets.sort((a, b) => a.slot.order - b.slot.order);
    marked.sort((a, b) => (attempts[b.id].lastAt ?? "").localeCompare(attempts[a.id].lastAt ?? ""));
    const dueByLane = DUE_LANE_ORDER.map((lane) => ({
      lane,
      sets: dueSets.filter((d) => d.slot.lane === lane).map((d) => d.set),
    })).filter((section) => section.sets.length > 0);
    return { dueByLane, marked };
  }, [sets, attempts, subject, due.slots, due.weekStart]);

  const dueCount = dueByLane.reduce((n, section) => n + section.sets.length, 0);
  const pageLoading = loading || enrolmentsLoading || due.loading || loadedKey !== dueKey;

  // Land on something worth reading, as Tasks does: Due when anything is due,
  // otherwise the quizzes that have been done. Not while the week is loading.
  useEffect(() => {
    if (pageLoading) return;
    const count = { due: dueCount, marked: marked.length };
    if (count[tab] > 0) return;
    const other: McqTab = tab === "due" ? "marked" : "due";
    if (count[other] > 0) setTab(other);
  }, [pageLoading, dueCount, marked.length, tab, setTab]);

  return (
    <AppLayout title="Weekly MCQs">
      {pageLoading ? (
        <Spinner label="Loading your quizzes" />
      ) : loadError ? (
        <ErrorNote error={loadError} />
      ) : !subject ? (
        <EmptyState
          mascot="pencil"
          mood="sleepy"
          title="No quizzes yet"
          body="Nothing has been set for your subjects so far. Ask your tutor to generate one for this week — quizzes are the quickest way to find the spec points you haven't nailed yet."
        />
      ) : (
        // The subject tint wraps the whole page, so the cards and every chip
        // inside them are one colour without any of them naming it.
        <div className={SUBJECT_TINT[subject] ?? "tint-primary"}>
          {/* Without the week, Due can't say what is due: say so rather than
              pass off an empty tab as the whole of it. */}
          {due.error && (
            <div className="mb-5">
              <ErrorNote error={due.error} onRetry={() => void due.reload()} />
            </div>
          )}

          {dueCount === 0 && marked.length === 0 ? (
            <EmptyState
              mascot="pencil"
              mood="sleepy"
              title={`No ${subjectLabel(subject)} quizzes yet`}
              body="Nothing has been written for this subject so far. It'll appear here as soon as your plan reaches a spec point with a quiz behind it."
            />
          ) : (
            <>
              <div className="mb-5 overflow-x-auto">
                <SegmentedToggle
                  layoutId="mcq-tab-pill"
                  label="Quiz status"
                  value={tab}
                  onChange={(v) => setTab(v as McqTab)}
                  items={[
                    { value: "due", label: "Due", count: dueCount },
                    { value: "marked", label: "Marked", count: marked.length },
                  ]}
                />
              </div>

              <div data-guide="mcq-list">
                {tab === "due" ? (
                  // Every lane open at once, under the dashboard's names.
                  <DueLanes>
                    {dueByLane.map(({ lane, sets: work }) => (
                      <DueSection key={lane} lane={lane} count={work.length}>
                        <QuizGrid sets={work} attempts={attempts} />
                      </DueSection>
                    ))}
                  </DueLanes>
                ) : (
                  <div className="space-y-3">
                    {groupUnderTopics(
                      marked,
                      (s) => s.topic ?? noTopic("other", "Other quizzes"),
                      (s) => s.specCode ?? s.title,
                    ).map((group) => (
                      <MarkedTopic
                        key={group.key}
                        stateKey={`mcqs.marked.${group.key}`}
                        title={group.title}
                        count={group.items.length}
                        noun={["quiz", "quizzes"]}
                      >
                        <QuizGrid sets={group.items} attempts={attempts} />
                      </MarkedTopic>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </AppLayout>
  );
}

function QuizGrid({ sets, attempts }: { sets: QuizSet[]; attempts: Record<string, Attempt> }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sets.map((s) => (
        <QuizCard key={s.id} set={s} attempt={attempts[s.id]} />
      ))}
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
          <span className="chip chip-solid">
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
          {!attempt
            ? "Start"
            : attempt.opensAt && attempt.opensAt.getTime() > Date.now()
              ? "Review"
              : "Retake"}
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

type AttemptRow = { set_id: string; score: number; total: number; created_at: string };

type SetQueryRow = {
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  spec_point_id: string | null;
  subject: string | null;
  spec_points: {
    code: string | null;
    topics: { id: string; title: string; sort_order: number; subject: string } | null;
  } | null;
};
