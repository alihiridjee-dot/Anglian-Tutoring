import { useQuery } from "@tanstack/react-query";
import { useWeekPlan } from "./useWeekPlan";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { WeeklyPlanDAL, type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { PlannerRosterDAL } from "@/lib/planner/plannerRosterDal";
import { type SubjectV, type BoardV } from "@/lib/curriculum/taxonomy";
import { mondayOf, addWeeks, toDateKey, weekRangeLabel } from "@/lib/planner/week";

/**
 * The tutor planner's working state: which student, subject and week are in
 * view, that week's plan, and adding spec points to it.
 */
export function useTutorPlanner() {
  const roster = useQuery({
    queryKey: ["planner-roster"],
    queryFn: () => PlannerRosterDAL.listStudents(),
  });
  const students = roster.data ?? null;
  const [studentId, setStudentId] = useState<string>("");
  useEffect(() => {
    if (!studentId && students?.length) setStudentId(students[0].id);
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
  const isCurrent = weekOffset === 0;
  const showReview = weekOffset <= 0;

  const [picking, setPicking] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  // Bumped after any plan mutation so the roadmap below re-derives from the DB —
  // keeping the curriculum view in sync with edits in real time.
  const [refreshToken, setRefreshToken] = useState(0);
  const bumpRefresh = () => setRefreshToken((n) => n + 1);

  const week = useWeekPlan({
    studentId,
    subject: (active?.subject ?? "biology") as SubjectV,
    board: (active?.board ?? "aqa") as BoardV,
    level: student?.level ?? "gcse",
    weekStart,
    isCurrent: false,
    withCoverage: showReview,
  });
  const { plan, points, coverage, activity, roadmap, loading, reload } = week;
  useEffect(() => {
    setPicking(false);
    setToAdd([]);
  }, [studentId, active?.subject, active?.board, weekStart]);

  const addSelected = async () => {
    if (!student || !active || toAdd.length === 0) return;
    setAdding(true);
    try {
      if (plan) {
        await WeeklyPlanDAL.addPoints(plan.id, toAdd, "tutor");
      } else {
        if (!student.level) throw new Error("Student has no exam level set.");
        await WeeklyPlanDAL.savePlan({
          subject: active.subject as SubjectV,
          board: active.board as BoardV,
          level: student.level,
          weekStart,
          specPointIds: toAdd,
          source: "tutor",
          origin: "tutor",
          studentId: student.id,
        });
      }
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

  const groups = useMemo(() => {
    const m = new Map<string, { title: string; points: PlanPoint[] }>();
    for (const p of points) {
      const g = m.get(p.topic_id) ?? { title: p.topic_title ?? "—", points: [] };
      g.points.push(p);
      m.set(p.topic_id, g);
    }
    return [...m.values()];
  }, [points]);

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
    weekOffset,
    setWeekOffset,
    weekStart,
    weekLabel,
    isCurrent,
    showReview,
    picking,
    setPicking,
    toAdd,
    setToAdd,
    adding,
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
  };
}

export type TutorPlannerState = ReturnType<typeof useTutorPlanner>;
/** One topic's points in the week being edited. */
export type PlanPointGroup = TutorPlannerState["groups"][number];
