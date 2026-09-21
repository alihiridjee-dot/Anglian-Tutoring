import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Plus,
  Users,
  CalendarRange,
} from "lucide-react";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type PlannerStudent } from "@/lib/planner/plannerRosterDal";
import { type SubjectV, type BoardV } from "@/lib/curriculum/taxonomy";
import { statusOfPoint } from "@/lib/planner/coverage";
import { SpecPointSelect } from "@/components/tutor/SpecPointSelect";
import { CoveragePill } from "./CoveragePill";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { type PlanPointGroup, type TutorPlannerState } from "./useTutorPlanner";

/** The plan cannot fit before the exam: what is left over, for the tutor to triage. */
export function SchedulingAttention({ roadmap }: { roadmap: RoadmapResult }) {
  return (
    <section className="premium-card tint-amber rounded-xl p-4 mb-4">
      <h3>Scheduling needs attention</h3>
      <p className="text-sm">
        {roadmap.reviewBacklog.length} reviews cannot fit before the exam.{" "}
        {roadmap.unscheduledTopicTitles.length} topics lack teaching time.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-bold">See outstanding work</summary>
        <ul className="list-disc pl-5 text-sm">
          {roadmap.reviewBacklog.map((p) => (
            <li key={p.specPointId}>
              {p.code} {p.pointTitle}
            </li>
          ))}
          {roadmap.unscheduledTopicTitles.map((t) => (
            <li key={t}>{t} — teaching time needed</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Student picker + week nav. */
export function PlannerToolbar({
  students,
  studentId,
  setStudentId,
  isCurrent,
  weekOffset,
  setWeekOffset,
  weekLabel,
}: Pick<
  TutorPlannerState,
  "studentId" | "setStudentId" | "isCurrent" | "weekOffset" | "setWeekOffset" | "weekLabel"
> & { students: PlannerStudent[] }) {
  return (
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
            className="block mt-0.5 h-8 rounded-lg premium-card px-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
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
  );
}

export function SubjectTabs({
  ordered,
  activeSubject,
  setActiveSubject,
}: Pick<TutorPlannerState, "ordered" | "activeSubject" | "setActiveSubject">) {
  return (
    <div className="flex items-center gap-1.5 mb-4">
      {ordered.map((e) => (
        <button
          key={e.subject}
          type="button"
          onClick={() => setActiveSubject(e.subject)}
          className={`h-8 px-3 rounded-lg text-sm font-medium transition ${
            e.subject === activeSubject
              ? "btn-solid"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {subjectLabel(e.subject)}
        </button>
      ))}
    </div>
  );
}

/** One topic of the week being edited, with each point's coverage on past and current weeks. */
export function WeekPointGroup({
  g,
  coverage,
  activity,
  showReview,
}: Pick<TutorPlannerState, "coverage" | "activity" | "showReview"> & { g: PlanPointGroup }) {
  return (
    <div>
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
                {(p.carried_from || p.origin === "carried_over") && (
                  <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                    carried over
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {showReview && (
                  <CoveragePill
                    status={statusOfPoint(cov, activity.get(p.spec_point_id))}
                    score={cov?.bestScore}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Add spec points to the week: the closed button, or the open picker. */
export function AddPointsBox({
  picking,
  setPicking,
  student,
  active,
  toAdd,
  setToAdd,
  adding,
  addSelected,
  weekLabel,
}: Pick<
  TutorPlannerState,
  "picking" | "setPicking" | "toAdd" | "setToAdd" | "adding" | "addSelected" | "weekLabel"
> & { student: PlannerStudent; active: { subject: string; board: string } }) {
  return picking ? (
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
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg btn-solid text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
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
      <Plus className="w-4 h-4" /> Add spec points to {weekLabel}
    </button>
  );
}
