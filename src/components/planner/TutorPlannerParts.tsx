import { useState } from "react";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Plus,
  Users,
  CalendarRange,
  X,
  ArrowRightLeft,
  Ban,
  Pin,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type PlannerStudent } from "@/lib/planner/plannerRosterDal";
import { type SubjectV, type BoardV } from "@/lib/curriculum/taxonomy";
import { statusOfPoint } from "@/lib/planner/coverage";
import { type PlanOverride } from "@/lib/planner/overrides";
import { weekKeyToDate, weekRangeLabel } from "@/lib/planner/week";
import { SpecPointSelect } from "@/components/tutor/SpecPointSelect";
import { CoveragePill } from "./CoveragePill";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { type TutorPlannerState } from "./useTutorPlanner";
import {
  laneLabel,
  type AssignmentWarning,
  type TutorWeekGroup,
  type TutorWeekRow,
} from "./tutorWeekRows";
import { type TutorOverrideActions } from "./useTutorOverrides";

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

const weekLabelOf = (key: string) => weekRangeLabel(weekKeyToDate(key));

/** The controls one row offers: remove, move, skip. Hidden on a row that cannot be changed. */
function RowActions({
  row,
  actions,
  weekChoices,
}: {
  row: TutorWeekRow;
  actions: TutorOverrideActions;
  weekChoices: string[];
}) {
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState(weekChoices[0] ?? "");
  const busy = actions.busy;
  const thisRow = busy && "specPointId" in busy && busy.specPointId === row.specPointId;
  const disabled = busy !== null;
  const icon =
    "w-7 h-7 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center disabled:opacity-40";
  if (moving) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label={`Move ${row.code} to week`}
          className="h-7 rounded-lg premium-card px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {weekChoices.map((w) => (
            <option key={w} value={w}>
              {weekLabelOf(w)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || !target}
          onClick={async () => {
            await actions.move(row, target);
            setMoving(false);
          }}
          className="h-7 px-2.5 rounded-lg btn-solid text-xs font-semibold disabled:opacity-50"
        >
          {thisRow && busy?.action === "move" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            "Move"
          )}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setMoving(false)}
          className="h-7 px-2 rounded-lg border border-border text-xs font-medium hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {weekChoices.length > 0 && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            // The choices follow the week in view; start from the first one now.
            setTarget(weekChoices[0] ?? "");
            setMoving(true);
          }}
          className={icon}
          title="Move to another week"
          aria-label={`Move ${row.code} to another week`}
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => actions.skip(row)}
        className={icon}
        title="Skip in the programme — never set automatically"
        aria-label={`Skip ${row.code} in the programme`}
      >
        {thisRow && busy?.action === "skip" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Ban className="w-3.5 h-3.5" />
        )}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => actions.remove(row)}
        className={icon}
        title={row.state === "projected" ? "Don't set this week" : "Remove from this week"}
        aria-label={`Remove ${row.code} from this week`}
      >
        {thisRow && busy?.action === "remove" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <X className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}

/** One topic of the week being edited: what the student has, what the programme will add, and the controls. */
export function WeekPointGroup({
  g,
  coverage,
  activity,
  showReview,
  editable,
  overridesAvailable,
  actions,
  weekChoices,
}: Pick<
  TutorPlannerState,
  | "coverage"
  | "activity"
  | "showReview"
  | "editable"
  | "overridesAvailable"
  | "actions"
  | "weekChoices"
> & { g: TutorWeekGroup }) {
  const controls = editable && overridesAvailable === true;
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
        {g.title}
      </h3>
      <div className="space-y-1.5">
        {g.rows.map((row) => {
          const cov = coverage.get(row.specPointId);
          const projected = row.state === "projected";
          return (
            <div
              key={row.specPointId}
              className={`group flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-2.5 ${
                projected
                  ? "border-dashed border-border bg-transparent"
                  : "border-border bg-muted/20"
              }`}
            >
              <div className="flex-1 min-w-[12rem]">
                <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">
                  {row.code}
                </span>
                <span className={`text-sm ${projected ? "text-muted-foreground" : ""}`}>
                  {row.title}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {projected ? (
                  <span
                    className="chip tint-slate text-[10px]"
                    title="Not saved yet — this is what the programme will set unless you change it"
                  >
                    Planned
                  </span>
                ) : (
                  <span
                    className={`chip text-[10px] ${row.pinned ? "tint-primary" : "tint-slate"}`}
                  >
                    {row.pinned && <Pin className="w-3 h-3" aria-hidden />}
                    {laneLabel(row)}
                  </span>
                )}
                {row.carriedFrom && !projected && (
                  <span className="chip tint-amber text-[10px]">
                    <RotateCcw className="w-3 h-3" aria-hidden /> carried over
                  </span>
                )}
                {row.doneAt && (
                  <span className="chip tint-emerald text-[10px]" title="Ticked off by the student">
                    <CheckCircle2 className="w-3 h-3" aria-hidden /> Done
                  </span>
                )}
                {showReview && !projected && (
                  <CoveragePill
                    status={statusOfPoint(cov, activity.get(row.specPointId))}
                    score={cov?.bestScore}
                  />
                )}
              </div>
              {controls && !row.doneAt && (
                <RowActions row={row} actions={actions} weekChoices={weekChoices} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What the tutor has set aside — removed from this week, or skipped in the programme — with the way back. */
export function OverridesPanel({
  weekOverrides,
  labels,
  actions,
  editable,
  weekLabel,
  subject,
}: Pick<TutorPlannerState, "weekOverrides" | "labels" | "actions" | "editable" | "weekLabel"> & {
  subject: string;
}) {
  const { removed, skipped } = weekOverrides;
  if (removed.length === 0 && skipped.length === 0) return null;
  const busy = actions.busy;
  const item = (o: PlanOverride) => {
    const meta = labels.get(o.specPointId);
    const code = meta?.code ?? o.specPointId.slice(0, 8);
    const restoring = busy?.action === "restore" && busy.overrideId === o.id;
    return (
      <li
        key={o.id}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/10 px-3 py-2"
      >
        <span className="flex-1 min-w-[12rem] text-sm">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">{code}</span>
          <span className="text-muted-foreground line-through decoration-border">
            {meta?.title ?? "Spec point"}
          </span>
          {o.note && <span className="block text-xs text-muted-foreground mt-0.5">{o.note}</span>}
        </span>
        {editable && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => actions.restore(o, code)}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {restoring ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Undo2 className="w-3.5 h-3.5" />
            )}
            Restore
          </button>
        )}
      </li>
    );
  };
  return (
    <div className="space-y-3">
      {removed.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
            Removed from {weekLabel}
          </h3>
          <ul className="space-y-1.5">{removed.map(item)}</ul>
        </section>
      )}
      {skipped.length > 0 && (
        <details className="group/skipped">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 list-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              <Ban className="w-3 h-3" aria-hidden />
              Skipped in {subjectLabel(subject)} ({skipped.length})
            </span>
          </summary>
          <ul className="space-y-1.5">{skipped.map(item)}</ul>
        </details>
      )}
    </div>
  );
}

/** The override controls need a database update that has not been installed. */
export function OverridesUnavailable() {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[12px]">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <span>
        Removing, moving and skipping spec points needs the planner override database update. Adding
        points still works.
      </span>
    </p>
  );
}

const WARNING_COPY: Record<AssignmentWarning["reason"], (w: AssignmentWarning) => string> = {
  covered: (w) => `already assessed at ${w.bestScore}%`,
  done: () => "already ticked off by the student",
  skipped: () => "skipped in the programme — this week's pin will still stand",
  "in-week": () => "already in this week",
};

/** Add spec points to the week: the closed button, or the open picker with its warnings. */
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
  warnings,
}: Pick<
  TutorPlannerState,
  | "picking"
  | "setPicking"
  | "toAdd"
  | "setToAdd"
  | "adding"
  | "addSelected"
  | "weekLabel"
  | "warnings"
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
          {warnings.length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2">
              <p className="text-[12px] font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                {warnings.length === 1 ? "One of these" : `${warnings.length} of these`} may not
                need setting
              </p>
              <ul className="mt-1 space-y-0.5 text-[12px]">
                {warnings.map((w) => (
                  <li key={w.specPointId}>
                    <span className="font-semibold">{w.code}</span> {w.title} —{" "}
                    {WARNING_COPY[w.reason](w)}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
              {warnings.length > 0 ? "Add anyway" : "Add"} {toAdd.length > 0 ? toAdd.length : ""}
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
