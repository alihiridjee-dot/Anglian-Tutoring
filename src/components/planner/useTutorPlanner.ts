import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useWeekPlan } from "./useWeekPlan";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PlannerRosterDAL, type PlannerStudent } from "@/lib/planner/plannerRosterDal";
import { PlanOverridesDAL } from "@/lib/planner/planOverridesDal";
import { selectWeek } from "@/lib/planner/weekCut";
import { overridesForWeek } from "@/lib/planner/overrides";
import { statusOfPoint, type PointStatus } from "@/lib/planner/coverage";
import { isSubject, type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import {
  addWeeks,
  currentWeekKey,
  toDateKey,
  weekKeyToDate,
  weekRangeLabel,
} from "@/lib/planner/week";
import { assignmentWarnings, laneSections, showsProjection, tutorWeekRows } from "./tutorWeekRows";
import { useTutorOverrides } from "./useTutorOverrides";
import type { PlannerSearch } from "@/lib/planner/plannerSearch";

export type TutorTab = "week" | "plan" | "topics";
export type RosterFilter = "all" | "unopened" | "pinned";

/** How the week is going, counted from the saved rows' coverage. */
export interface WeekStats {
  total: number;
  saved: number;
  projected: number;
  pinned: number;
  done: number;
  byStatus: Record<PointStatus, number>;
}

const isWeekKey = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * The tutor planner's working state. Which student, subject, week and tab are
 * open lives in the URL, so a student's week is a link: it survives a reload,
 * the back button works, and it can be handed to a colleague. Everything
 * derived — the roster's per-week summaries, the open student's week as they
 * will meet it, and the tutor's controls over it — hangs off that.
 */
export function useTutorPlanner() {
  // Read loosely, as the curriculum page does: the route's own reader would
  // bind this hook to one route id, and the search shape is already validated
  // by the route before it gets here.
  const search = useSearch({ strict: false }) as PlannerSearch;
  const navigate = useNavigate();
  const setSearch = useCallback(
    (patch: Partial<PlannerSearch>) => {
      void navigate({
        to: "/planner",
        search: (prev: PlannerSearch) => ({ ...prev, ...patch }),
        replace: true,
      });
    },
    [navigate],
  );

  /* ── Roster ─────────────────────────────────────────────────────────── */
  const roster = useQuery({
    queryKey: ["planner-roster"],
    queryFn: () => PlannerRosterDAL.listStudents(),
    staleTime: 60_000,
  });
  const students = useMemo(() => roster.data ?? null, [roster.data]);

  const currentWeek = currentWeekKey();
  const weekStart = isWeekKey(search.week) ? search.week : currentWeek;
  const weekLabel = weekRangeLabel(weekKeyToDate(weekStart));
  const isCurrent = weekStart === currentWeek;
  const showReview = weekStart <= currentWeek;
  // History is read-only: what was not set then is not owed now.
  const editable = weekStart >= currentWeek;
  const setWeek = useCallback((key: string) => setSearch({ week: key }), [setSearch]);
  const shiftWeek = useCallback(
    (n: number) => setWeek(toDateKey(addWeeks(weekKeyToDate(weekStart), n))),
    [setWeek, weekStart],
  );

  const summaries = useQuery({
    queryKey: ["planner-roster-week", weekStart],
    queryFn: () => PlannerRosterDAL.weekSummaries(weekStart),
    staleTime: 30_000,
  });

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const visibleStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byStudent = summaries.data ?? new Map();
    return (students ?? []).filter((s) => {
      if (q && !(s.name ?? "").toLowerCase().includes(q)) return false;
      if (filter === "all") return true;
      const mine = byStudent.get(s.id) ?? [];
      if (filter === "pinned") return mine.some((w: { pinned: number }) => w.pinned > 0);
      // Unopened: at least one enrolled subject with no plan row for the week.
      return s.enrolments.some(
        (e) => !mine.some((w: { subject: string }) => w.subject === e.subject),
      );
    });
  }, [students, summaries.data, query, filter]);

  /* ── Selection ──────────────────────────────────────────────────────── */
  const studentId = search.student ?? "";
  const student: PlannerStudent | null = students?.find((s) => s.id === studentId) ?? null;
  const selectStudent = useCallback(
    (id: string | null) => setSearch({ student: id ?? undefined, subject: undefined }),
    [setSearch],
  );

  const ordered = useMemo(
    () =>
      student
        ? [
            ...student.enrolments.filter((e) => e.subject === "biology"),
            ...student.enrolments.filter((e) => e.subject !== "biology"),
          ]
        : [],
    [student],
  );
  const activeSubject =
    (isSubject(search.subject) && ordered.some((e) => e.subject === search.subject)
      ? search.subject
      : ordered[0]?.subject) ?? "";
  const setSubject = useCallback((subject: string) => setSearch({ subject }), [setSearch]);
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];

  const tab: TutorTab = search.tab ?? "week";
  const setTab = useCallback((t: TutorTab) => setSearch({ tab: t }), [setSearch]);

  /* ── The open student's week ────────────────────────────────────────── */
  const [picking, setPicking] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [orderEditorOpen, setOrderEditorOpen] = useState(false);

  const course = {
    studentId,
    subject: (active?.subject ?? "biology") as SubjectV,
    board: (active?.board ?? "aqa") as BoardV,
    level: (student?.level ?? "gcse") as LevelV,
  };
  const week = useWeekPlan({
    ...course,
    weekStart,
    isCurrent: false,
    withCoverage: showReview,
    enabled: !!student && !!active,
  });
  const { plan, points, coverage, activity, roadmap, loading, reload } = week;
  /**
   * After any change to the plan: re-read the student's planner (the week and
   * the roadmap share one cache, so both tabs follow) and the roster's counts.
   */
  const refreshSummaries = summaries.refetch;
  const refreshAll = useCallback(async () => {
    await reload();
    void refreshSummaries();
  }, [reload, refreshSummaries]);
  useEffect(() => {
    setPicking(false);
    setToAdd([]);
    setOrderEditorOpen(false);
  }, [studentId, active?.subject, active?.board, weekStart]);

  // The override controls need the database update that carries the rule.
  const availability = useQuery({
    queryKey: ["planner-overrides-available"],
    queryFn: () => PlanOverridesDAL.available(),
    staleTime: 5 * 60_000,
  });
  const overridesAvailable = availability.data ?? null;

  const overrides = useMemo(() => roadmap?.overrides ?? [], [roadmap]);
  /**
   * What the programme will write into this week when it cuts it — shown
   * beside the saved rows so the tutor can change next week before the
   * student meets it. Never for a week the programme has already cut, where
   * the saved rows are the whole truth, and never for the past.
   */
  const projection = useMemo(
    () =>
      roadmap && showsProjection({ weekStart, currentWeek, plan })
        ? selectWeek(roadmap, weekStart)
        : null,
    [roadmap, weekStart, currentWeek, plan],
  );
  const rows = useMemo(
    () => tutorWeekRows({ saved: points, projection, roadmap, overrides, weekStart }),
    [points, projection, roadmap, overrides, weekStart],
  );
  const lanes = useMemo(() => laneSections(rows), [rows]);
  const stats = useMemo<WeekStats>(() => {
    const byStatus: Record<PointStatus, number> = {
      strong: 0,
      practised: 0,
      weak: 0,
      not_done: 0,
      not_set: 0,
    };
    if (showReview)
      for (const r of rows)
        if (r.state === "saved")
          byStatus[statusOfPoint(coverage.get(r.specPointId), activity.get(r.specPointId))]++;
    return {
      total: rows.length,
      saved: rows.filter((r) => r.state === "saved").length,
      projected: rows.filter((r) => r.state === "projected").length,
      pinned: rows.filter((r) => r.origin === "tutor").length,
      done: rows.filter((r) => !!r.doneAt).length,
      byStatus,
    };
  }, [rows, coverage, activity, showReview]);
  const weekOverrides = useMemo(
    () => overridesForWeek(overrides, weekStart),
    [overrides, weekStart],
  );
  /** Code and title for any point on the course, for the override lists. */
  const labels = useMemo(
    () =>
      new Map(
        (roadmap?.progress ?? []).flatMap((t) =>
          t.points.map((p) => [p.id, { code: p.code, title: p.title }] as const),
        ),
      ),
    [roadmap],
  );
  /** Mondays a point can be moved to: from this week to the exam, minus the week in view. */
  const weekChoices = useMemo(() => {
    const out: string[] = [];
    if (!roadmap) return out;
    for (
      let w = currentWeek;
      w < roadmap.examDate && out.length < 60;
      w = toDateKey(addWeeks(weekKeyToDate(w), 1))
    )
      if (w !== weekStart) out.push(w);
    return out;
  }, [roadmap, currentWeek, weekStart]);

  const warnings = useMemo(
    () => assignmentWarnings({ specPointIds: toAdd, roadmap, saved: points, overrides }),
    [toAdd, roadmap, points, overrides],
  );

  const actions = useTutorOverrides({
    course,
    weekStart,
    plan,
    studentName: student?.name ?? null,
    onChanged: () => void refreshAll(),
  });

  /**
   * Pin the picked points into the week as the tutor's choice. Anything the
   * tutor had removed from this week is un-removed first — see
   * `PlanOverridesDAL.pin` — and the warnings above have already told them
   * which points the student has covered.
   */
  const addSelected = async () => {
    if (!student || !active || toAdd.length === 0) return;
    setAdding(true);
    try {
      if (!student.level) throw new Error("Student has no exam level set.");
      await PlanOverridesDAL.pin({
        studentId: student.id,
        subject: active.subject as SubjectV,
        board: active.board as BoardV,
        level: student.level,
        weekStart,
        specPointIds: toAdd,
      });
      toast.success(`Added ${toAdd.length} spec ${toAdd.length === 1 ? "point" : "points"}.`);
      setToAdd([]);
      setPicking(false);
      await refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add those — try again.");
    } finally {
      setAdding(false);
    }
  };

  return {
    roster,
    students,
    summaries: summaries.data ?? null,
    query,
    setQuery,
    filter,
    setFilter,
    visibleStudents,
    studentId,
    student,
    selectStudent,
    ordered,
    activeSubject,
    setSubject,
    active,
    course,
    weekStart,
    weekLabel,
    currentWeek,
    isCurrent,
    showReview,
    editable,
    setWeek,
    shiftWeek,
    tab,
    setTab,
    picking,
    setPicking,
    toAdd,
    setToAdd,
    adding,
    warnings,
    refreshAll,
    week,
    plan,
    points,
    coverage,
    activity,
    roadmap,
    loading,
    reload,
    addSelected,
    rows,
    lanes,
    stats,
    projection,
    overrides,
    weekOverrides,
    overridesAvailable,
    labels,
    weekChoices,
    actions,
    orderEditorOpen,
    setOrderEditorOpen,
  };
}

export type TutorPlannerState = ReturnType<typeof useTutorPlanner>;
