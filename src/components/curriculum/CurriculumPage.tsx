import { Spinner } from "@/components/Shared";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { subjectTint } from "@/lib/curriculum/subjectTheme";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEntitlements } from "@/hooks/data/useEntitlements";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import {
  SUBJECTS,
  BOARDS,
  LEVELS,
  type SubjectV,
  type BoardV,
  type LevelV,
} from "@/lib/curriculum/taxonomy";
import { toast } from "sonner";
import { CurriculumDAL } from "@/lib/curriculum/curriculumDal";
import type { Topic, SpecPoint } from "@/lib/curriculum/types";
import { type CurriculumSearchParams } from "@/lib/curriculum/curriculumParams";
import { useDebounced } from "@/hooks/useGlobalSearch";
import { MIN_QUERY_LENGTH, queryTerms } from "@/lib/search/match";
import { CurriculumSyncPanel } from "@/components/CurriculumSyncPanel";
import { WhenLink } from "@/components/curriculum/ScheduleBadges";
import { usePlannerRoadmap } from "@/hooks/data/usePlanner";
import { courseSchedule } from "@/lib/planner/pointSchedule";
import { currentWeekKey } from "@/lib/planner/week";
import { BookMarked, ChevronLeft } from "lucide-react";
import { StudentSubjectPicker, Filter } from "@/components/curriculum/CurriculumFilters";
import { SpecPointDetail } from "@/components/curriculum/SpecPointDetail";
import { SpecSearchBar, SpecSearchResults } from "@/components/curriculum/SpecSearch";
import { TopicCard } from "@/components/curriculum/TopicCard";
import { TopicCreate } from "@/components/curriculum/TopicCreate";
import { labelOf } from "@/components/curriculum/styles";

export function Curriculum() {
  const { isTutor, userId } = useRoles();
  // Students are scoped to the subjects (and board/level) their subscription
  // covers; tutors author freely across everything. This is the client half of
  // the guardrail — topics/spec_points RLS enforces the same thing server-side.
  const ent = useEntitlements();
  const { level: profileLevel } = useEnrolments();
  // Read loosely (`strict: false`) rather than through `Route.useSearch()`:
  // the /demo/* showcase mounts this same component under a different route,
  // and a route-bound reader would throw there.
  const search = useSearch({ strict: false }) as CurriculumSearchParams;
  const navigate = useNavigate();
  const [subject, setSubject] = useState<SubjectV>(search.subject ?? "biology");
  const [board, setBoard] = useState<BoardV>(search.board ?? "edexcel");
  const [level, setLevel] = useState<LevelV>(search.level ?? "gcse");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [openTopicId, setOpenTopicId] = useState<string | null>(search.topic ?? null);
  const [loading, setLoading] = useState(true);

  /** Writes a partial change into the URL without disturbing the rest of it. */
  const patchSearch = useCallback(
    (patch: Partial<CurriculumSearchParams>, replace = false) => {
      navigate({
        search: (prev: CurriculumSearchParams) => ({ ...prev, ...patch }),
        replace,
      } as never);
    },
    [navigate],
  );

  // Snap a student's filters onto their entitlement: the first subject they're
  // enrolled in, at their board and level. Guards against the "biology/edexcel"
  // defaults exposing a subject they don't pay for.
  useEffect(() => {
    if (isTutor || ent.loading) return;
    if (ent.entitledSubjects.length && !ent.entitledSubjects.includes(subject)) {
      setSubject(ent.entitledSubjects[0]);
    }
    if (profileLevel) setLevel(profileLevel);
  }, [isTutor, ent.loading, ent.entitledSubjects, profileLevel, subject]);

  // A student's board is fixed to the one they sit the selected subject with.
  useEffect(() => {
    if (isTutor) return;
    const b = ent.boardBySubject[subject];
    if (b && b !== board) setBoard(b);
  }, [isTutor, subject, ent.boardBySubject, board]);

  // Selected specification point state to handle full sub-page navigation
  const [selectedSpecPoint, setSelectedSpecPoint] = useState<SpecPoint | null>(null);

  // A student's own plan for the selected course: how much of each topic is
  // covered, and when each uncovered point comes up. Only for a course they are
  // actually on — a tutor, or a subject they don't take, has no plan to show.
  const now = currentWeekKey();
  const onOwnCourse =
    !isTutor &&
    !!userId &&
    ent.entitledSubjects.includes(subject) &&
    ent.boardBySubject[subject] === board &&
    profileLevel === level;
  const roadmap = usePlannerRoadmap(
    { studentId: userId ?? "", subject, board, level },
    0,
    onOwnCourse,
  );
  const schedule = useMemo(
    () => (onOwnCourse && roadmap.data ? courseSchedule(roadmap.data, now) : null),
    [onOwnCourse, roadmap.data, now],
  );
  const scheduleLoading = onOwnCourse && roadmap.isLoading;

  // ── Specification search ────────────────────────────────────────────────
  // Searches the *whole* selected specification, not just the topics currently
  // expanded — the point being that a student searching "limiting factors"
  // doesn't know which topic it lives under, and shouldn't have to.
  const [query, setQuery] = useState(search.q ?? "");
  const settledQuery = useDebounced(query);
  const searching = settledQuery.trim().length >= MIN_QUERY_LENGTH;
  const searchTerms = useMemo(() => queryTerms(settledQuery), [settledQuery]);

  const { data: matches, isFetching: searchFetching } = useQuery({
    queryKey: ["curriculum-search", level, board, subject, settledQuery.trim()],
    queryFn: () => CurriculumDAL.searchSpecPoints(level, board, subject, settledQuery),
    enabled: searching,
    staleTime: 30_000,
    // Keep the last results up while the next ones land, so refining a query
    // narrows the list instead of blanking it.
    placeholderData: (prev) => prev,
  });

  // The box and the URL mirror each other, but only ever one way at a time —
  // otherwise the two effects fight, and arriving from the palette re-pushes
  // the query the incoming URL just cleared.
  const urlQuery = search.q ?? "";
  const urlQueryRef = useRef(urlQuery);
  useEffect(() => {
    urlQueryRef.current = urlQuery;
  }, [urlQuery]);

  // Box → URL. Keyed on the settled query *alone*, deliberately: it must fire
  // when the box changes and stay silent when the URL changes underneath it.
  // Replacing rather than pushing keeps one search to one history entry.
  useEffect(() => {
    const next = settledQuery.trim();
    if (next !== urlQueryRef.current.trim()) patchSearch({ q: next || undefined }, true);
  }, [settledQuery, patchSearch]);

  // URL → box, for the back button, a bookmark, or a link someone shared.
  useEffect(() => {
    setQuery((current) => (current.trim() === urlQuery.trim() ? current : urlQuery));
  }, [urlQuery]);

  /** Opens a spec point's detail page and makes it addressable in the URL. */
  const openSpecPoint = useCallback(
    (point: SpecPoint) => {
      setSelectedSpecPoint(point);
      patchSearch({ point: point.id });
    },
    [patchSearch],
  );

  const closeSpecPoint = useCallback(() => {
    setSelectedSpecPoint(null);
    patchSearch({ point: undefined });
  }, [patchSearch]);

  // A `?point=` arriving from elsewhere (global search, a bookmark, a link a
  // tutor sent) opens straight onto that point, without expanding its topic.
  useEffect(() => {
    const id = search.point;
    if (!id) {
      setSelectedSpecPoint(null);
      return;
    }
    if (selectedSpecPoint?.id === id) return;
    let cancelled = false;
    CurriculumDAL.getSpecPointById(id).then((point) => {
      if (!cancelled && point) setSelectedSpecPoint(point);
    });
    return () => {
      cancelled = true;
    };
  }, [search.point, selectedSpecPoint?.id]);

  // Likewise for the taxonomy and the topic to expand. A student's own
  // entitlement effects run after these and clamp anything out of bounds.
  useEffect(() => {
    if (search.subject) setSubject(search.subject);
    if (search.board) setBoard(search.board);
    if (search.level) setLevel(search.level);
  }, [search.subject, search.board, search.level]);

  useEffect(() => {
    if (search.topic) setOpenTopicId(search.topic);
  }, [search.topic]);

  const loadTopics = async () => {
    setLoading(true);
    try {
      const data = await CurriculumDAL.getTopics(level, board, subject);
      setTopics(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load curriculum");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTopics(); /* eslint-disable-next-line */
  }, [subject, board, level]);

  // Handle viewing full-page specification point details
  if (selectedSpecPoint) {
    return (
      <AppLayout title="Curriculum Point">
        <div className="max-w-4xl mx-auto space-y-6">
          <button
            data-guide="curriculum-back"
            onClick={closeSpecPoint}
            className="inline-flex items-center gap-2 min-h-11 sm:min-h-0 text-sm text-muted-foreground hover:text-primary transition font-semibold"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Curriculum
          </button>

          <div className="rounded-2xl premium-card p-4 sm:p-6 relative overflow-hidden shadow-xs">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-accent" />

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold bg-primary/10 text-primary">
                {labelOf(LEVELS, level)}
              </span>
              <span className="text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold bg-accent/10 text-accent">
                {labelOf(BOARDS, board)}
              </span>
              <span className="text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold bg-secondary text-foreground">
                {subject.toUpperCase()}
              </span>
            </div>

            <p className="text-[10px] uppercase tracking-wider font-extrabold text-primary">
              Specification Point {selectedSpecPoint.code}
            </p>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-foreground mt-1.5 leading-snug break-words">
              {selectedSpecPoint.title}
            </h2>
            {selectedSpecPoint.description && (
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed whitespace-pre-wrap break-words">
                {selectedSpecPoint.description}
              </p>
            )}
            {schedule?.byPoint.get(selectedSpecPoint.id) && (
              <div className={`mt-5 ${subjectTint(subject)}`}>
                <WhenLink
                  when={schedule.byPoint.get(selectedSpecPoint.id)!}
                  now={now}
                  subject={subject}
                />
              </div>
            )}
          </div>

          <div className="mt-8">
            <SpecPointDetail
              point={selectedSpecPoint}
              isTutor={isTutor}
              onChanged={loadTopics}
              taxonomy={{ subject, board, level }}
            />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Curriculum">
      {/* The whole page carries the subject's tint, so switching from Biology
          to Chemistry repaints every card, meter and shadow below in violet
          without a single conditional class in the markup. */}
      <div className={subjectTint(subject)}>
        <p className="text-muted-foreground mb-6 max-w-2xl">
          Explore interactive specification points across chemistry, physics, and biology. Select
          your level, exam board, and subject to begin.
        </p>

        <div data-guide="curriculum-filters" className="rounded-2xl premium-card p-4 sm:p-5 mb-6">
          {isTutor ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Filter
                label="Subject"
                value={subject}
                onChange={(v) => setSubject(v as SubjectV)}
                opts={SUBJECTS}
              />
              <Filter
                label="Board"
                value={board}
                onChange={(v) => setBoard(v as BoardV)}
                opts={BOARDS}
              />
              <Filter
                label="Level"
                value={level}
                onChange={(v) => setLevel(v as LevelV)}
                opts={LEVELS}
              />
            </div>
          ) : (
            <StudentSubjectPicker
              subject={subject}
              onSelect={setSubject}
              board={board}
              level={level}
              entitlements={ent}
            />
          )}

          <div data-guide="curriculum-search" className="mt-4 pt-4 border-t border-border">
            <SpecSearchBar
              value={query}
              onChange={setQuery}
              subject={subject}
              board={board}
              level={level}
            />
          </div>
        </div>

        {searching ? (
          <SpecSearchResults
            matches={matches ?? []}
            terms={searchTerms}
            loading={searchFetching && !matches}
            query={settledQuery}
            onSelect={openSpecPoint}
            onClear={() => setQuery("")}
          />
        ) : (
          <>
            {isTutor && (
              <CurriculumSyncPanel
                subject={subject}
                board={board}
                level={level}
                onSynced={loadTopics}
              />
            )}

            {isTutor && (
              <TopicCreate subject={subject} board={board} level={level} onCreated={loadTopics} />
            )}

            {loading ? (
              <Spinner label="Loading topics" className="py-10" />
            ) : topics.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
                <BookMarked className="w-8 h-8 mx-auto mb-3 opacity-50" />
                No topics yet for this subject/board/level.
                {isTutor && <p className="mt-2 text-xs">Add one above to get started.</p>}
              </div>
            ) : (
              <div data-guide="curriculum-topics" className="space-y-3">
                {topics.map((t) => (
                  <TopicCard
                    key={t.id}
                    topic={t}
                    open={openTopicId === t.id}
                    onToggle={() => setOpenTopicId(openTopicId === t.id ? null : t.id)}
                    isTutor={isTutor}
                    onDeleted={loadTopics}
                    level={level}
                    board={board}
                    subject={subject}
                    onSelectSpecPoint={openSpecPoint}
                    schedule={schedule}
                    scheduleLoading={scheduleLoading}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
