import { useQuery } from "@tanstack/react-query";
import { useWeekPlan } from "./useWeekPlan";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PlannerRosterDAL } from "@/lib/planner/plannerRosterDal";
import { PlanOverridesDAL } from "@/lib/planner/planOverridesDal";
import { selectWeek } from "@/lib/planner/weekCut";
import { overridesForWeek } from "@/lib/planner/overrides";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import {
  mondayOf,
  addWeeks,
  currentWeekKey,
  toDateKey,
  weekKeyToDate,
  weekRangeLabel,
} from "@/lib/planner/week";
import {
  assignmentWarnings,
  showsProjection,
  tutorWeekRows,
  type TutorWeekGroup,
} from "./tutorWeekRows";
import { useTutorOverrides } from "./useTutorOverrides";

/**
 * The tutor planner's working state: which student, subject and week are in
 * view, that week as the student will meet it — what is saved plus what the
 * programme will add — and the tutor's controls over it.
 */
export function useTutorPlanner(initialStudentId?: string) {
  const roster = useQuery({
    queryKey: ["planner-roster"],
    queryFn: () => PlannerRosterDAL.listStudents(),
  });
  const students = roster.data ?? null;
  const [studentId, setStudentId] = useState<string>(initialStudentId ?? "");
  useEffect(() => {
    // A requested student who isn't on the roster (no enrolments, or not a
    // student) falls back to the first, the same as no request at all.
    if (students?.length && !students.some((s) => s.id === studentId)) {
      setStudentId(students[0].id);
    }
  }, [students, studentId]);

  const student = students?.find((s) => s.id === studentId) ?? null;
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
  const [activeSubject, setActiveSubject] = useState<string>("");
  useEffect(() => {
    setActiveSubject(ordered[0]?.subject ?? "");
  }, [ordered]);
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];

  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = toDateKey(addWeeks(mondayOf(), weekOffset));
  const weekLabel = weekRangeLabel(addWeeks(mondayOf(), weekOffset));
  const currentWeek = currentWeekKey();
  const isCurrent = weekOffset === 0;
  const showReview = weekOffset <= 0;
  // History is read-only: what was not set then is not owed now.
  const editable = weekOffset >= 0;

  const [picking, setPicking] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [orderEditorOpen, setOrderEditorOpen] = useState(false);
  // Bumped after any plan mutation so the roadmap below re-derives from the DB —
  // keeping the curriculum view in sync with edits in real time.
  const [refreshToken, setRefreshToken] = useState(0);
  const bumpRefresh = () => setRefreshToken((n) => n + 1);

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
  });
  const { plan, points, coverage, activity, roadmap, loading, reload } = week;
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
  const groups: TutorWeekGroup[] = useMemo(
    () => tutorWeekRows({ saved: points, projection, roadmap, overrides, weekStart }),
    [points, projection, roadmap, overrides, weekStart],
  );
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
    onChanged: () => {
      void reload();
      bumpRefresh();
    },
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
      await reload();
      bumpRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add those — try again.");
    } finally {
      setAdding(false);
    }
  };

  return {
    roster,
    students,
    studentId,
    setStudentId,
    student,
    ordered,
    activeSubject,
    setActiveSubject,
    active,
    course,
    weekOffset,
    setWeekOffset,
    weekStart,
    weekLabel,
    currentWeek,
    isCurrent,
    showReview,
    editable,
    picking,
    setPicking,
    toAdd,
    setToAdd,
    adding,
    warnings,
    refreshToken,
    bumpRefresh,
    week,
    plan,
    points,
    coverage,
    activity,
    roadmap,
    loading,
    reload,
    addSelected,
    groups,
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
