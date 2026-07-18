import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Plus,
  Users,
  CalendarRange,
} from "lucide-react";
import {
  WeeklyPlanDAL,
  type WeeklyPlan,
  type PlanPoint,
  type PlannerStudent,
} from "@/lib/weeklyPlanDal";
import { type SubjectV, type BoardV } from "@/lib/taxonomy";
import { mondayOf, addWeeks, toDateKey, weekRangeLabel } from "@/lib/week";
import { type PointCoverage, statusOf } from "@/lib/planner/coverage";
import { ScheduleDAL } from "@/lib/scheduleDal";
import { RoadmapPanel } from "./RoadmapPanel";
import { CoveredLedger } from "./CoveredLedger";
import { SpecPointSelect } from "@/components/tutor/SpecPointSelect";
import { CoveragePill } from "./CoveragePill";
import { WeekReview } from "./WeekReview";

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

/**
 * The tutor's window into any student's weekly plan. Pick a student, page
 * through their weeks, and adjust the plan — add spec points from the curriculum
 * picker, remove them, and see the coverage/check-in for past weeks. Writes bind
 * to the chosen student (tutor RLS on the plan tables allows it).
 */
export function TutorPlannerPanel() {
  const [students, setStudents] = useState<PlannerStudent[] | null>(null);
  const [studentId, setStudentId] = useState<string>("");

  useEffect(() => {
    WeeklyPlanDAL.listStudents().then((s) => {
      setStudents(s);
      setStudentId((prev) => prev || s[0]?.id || "");
    });
  }, []);

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

  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [points, setPoints] = useState<PlanPoint[]>([]);
  const [coverage, setCoverage] = useState<Map<string, PointCoverage>>(new Map());
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    if (!student || !active) {
      setPlan(null);
      setPoints([]);
      setCoverage(new Map());
      return;
    }
    setLoading(true);
    const res = await WeeklyPlanDAL.getPlan(student.id, active.subject as SubjectV, weekStart);
    const pts = res?.points ?? [];
    setPlan(res?.plan ?? null);
    setPoints(pts);
    const ids = pts.map((p) => p.spec_point_id);
    if (showReview && ids.length) {
      // Keep the student's SR schedule current from their real homework/MCQ
      // results before reading coverage (idempotent; tutor RLS allows the write).
      await ScheduleDAL.syncReviewsFromAttempts(student.id, ids).catch(() => {});
    }
    setCoverage(
      showReview && ids.length ? await WeeklyPlanDAL.getCoverage(student.id, ids) : new Map(),
    );
    setLoading(false);
  };

  useEffect(() => {
    reload();
    setPicking(false);
    setToAdd([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, active?.subject, active?.board, weekStart]);

  const remove = async (specPointId: string) => {
    if (!plan) return;
    setPoints((prev) => prev.filter((p) => p.spec_point_id !== specPointId));
    try {
      await WeeklyPlanDAL.removePoint(plan.id, specPointId);
    } catch {
      await reload();
    }
  };

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

  if (students === null) {
    return (
      <div className="rounded-2xl bg-card border border-border p-16 text-center shadow-sm">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl bg-card border border-border p-4 sm:p-5 shadow-sm">
        {/* Student picker + week nav */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Student
              </label>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="block mt-0.5 h-8 rounded-lg border border-border bg-card px-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {students.length === 0 && <option value="">No students</option>}
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.id.slice(0, 8)}
                    {s.enrolments.length === 0 ? " (no enrolments)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5">
                <CalendarRange className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {isCurrent ? "This week" : weekOffset < 0 ? "Past week" : "Upcoming"}
                </span>
                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => setWeekOffset(0)}
                    className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <Undo2 className="w-3 h-3" /> Today
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{weekLabel}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setWeekOffset((w) => w - 1)}
                className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
                aria-label="Previous week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setWeekOffset((w) => w + 1)}
                className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
                aria-label="Next week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Subject tabs */}
        {ordered.length > 0 && (
          <div className="flex items-center gap-1.5 mb-4">
            {ordered.map((e) => (
              <button
                key={e.subject}
                type="button"
                onClick={() => setActiveSubject(e.subject)}
                className={`h-8 px-3 rounded-lg text-sm font-medium transition ${
                  e.subject === activeSubject
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {subjectLabel[e.subject] ?? e.subject}
              </button>
            ))}
          </div>
        )}

        {!student || !active ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {student && student.enrolments.length === 0
              ? "This student has no subject enrolments yet."
              : "Pick a student to view and adjust their weekly plan."}
          </p>
        ) : loading ? (
          <div className="py-10 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {points.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No plan for this week yet — add spec points below to build one.
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.title}>
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                    {g.title}
                  </h3>
                  <div className="space-y-1.5">
                    {g.points.map((p) => {
                      const cov = coverage.get(p.spec_point_id);
                      return (
                        <div
                          key={p.spec_point_id}
                          className="group flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-2.5"
                        >
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">
                              {p.code}
                            </span>
                            <span className="text-sm">{p.title}</span>
                            {p.origin === "carried_over" && (
                              <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                                carried over
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {showReview && (
                              <CoveragePill status={statusOf(cov)} score={cov?.bestScore} />
                            )}
                            <button
                              type="button"
                              onClick={() => remove(p.spec_point_id)}
                              className="w-6 h-6 rounded-md text-muted-foreground/50 hover:text-rose-500 hover:bg-rose-500/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                              aria-label="Remove from this week"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}

            {/* Add spec points */}
            {picking ? (
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                {student.level ? (
                  <>
                    <SpecPointSelect
                      subject={active.subject as SubjectV}
                      board={active.board as BoardV}
                      level={student.level}
                      value={toAdd}
                      onChange={setToAdd}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPicking(false);
                          setToAdd([]);
                        }}
                        className="h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={addSelected}
                        disabled={adding || toAdd.length === 0}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                      >
                        {adding ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                        Add {toAdd.length > 0 ? toAdd.length : ""}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This student has no exam level set — set it on their profile before planning.
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted"
              >
                <Plus className="w-4 h-4" /> Add spec points
              </button>
            )}

            {showReview && plan && (
              <WeekReview
                studentId={student.id}
                plan={plan}
                points={points}
                coverage={coverage}
                subject={active.subject as SubjectV}
                board={active.board as BoardV}
                level={student.level ?? "gcse"}
                weekStart={weekStart}
                onChanged={reload}
                readOnly
              />
            )}
          </div>
        )}
      </div>
      {student && student.level && (
        <>
          <RoadmapPanel
            studentId={student.id}
            enrolments={student.enrolments}
            level={student.level}
          />
          <CoveredLedger
            studentId={student.id}
            enrolments={student.enrolments}
            level={student.level}
          />
        </>
      )}
    </>
  );
}
