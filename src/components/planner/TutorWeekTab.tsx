import { CheckCircle2, RotateCcw, Sparkles } from "lucide-react";
import { Spinner } from "@/components/Shared";
import { type SubjectV, type BoardV } from "@/lib/curriculum/taxonomy";
import { statusOfPoint, STATUS_STYLE, type PointStatus } from "@/lib/planner/coverage";
import { WithheldPlanPoints } from "./WithheldPlanPoints";
import { WeekReview } from "./WeekReview";
import { CoveragePill } from "./CoveragePill";
import { TutorRowMenu } from "./TutorRowMenu";
import { AddPointsBox, OverridesPanel, OverridesUnavailable } from "./TutorPlannerParts";
import { type TutorWeekRow } from "./tutorWeekRows";
import { type TutorPlannerState } from "./useTutorPlanner";
import { WeekSwitcher } from "./WeekSwitcher";

const COUNTED: PointStatus[] = ["strong", "practised", "weak", "not_done"];

/** One line on how the week stands: counts only, nothing for zero. */
function StatsStrip({ state }: { state: TutorPlannerState }) {
  const { stats, showReview } = state;
  if (stats.total === 0) return null;
  const chips: { label: string; className: string }[] = [
    {
      label: `${stats.total} ${stats.total === 1 ? "point" : "points"}`,
      className: "tint-slate",
    },
  ];
  if (showReview)
    for (const s of COUNTED)
      if (stats.byStatus[s] > 0)
        chips.push({
          label: `${stats.byStatus[s]} ${STATUS_STYLE[s].label.toLowerCase()}`,
          className: STATUS_STYLE[s].pill,
        });
  if (stats.pinned > 0)
    chips.push({ label: `${stats.pinned} set by you`, className: "tint-primary" });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span key={c.label} className={`chip text-[11px] ${c.className}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

/** One spec point in the week: what it is, how it went, and the menu to change it. */
function Row({ row, state }: { row: TutorWeekRow; state: TutorPlannerState }) {
  const { coverage, activity, showReview, editable, overridesAvailable, actions, weekChoices } =
    state;
  const cov = coverage.get(row.specPointId);
  const canChange = editable && overridesAvailable === true && !row.doneAt;
  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">{row.code}</span>
        <span className="text-sm">{row.title}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {row.carriedFrom && (
          <span className="chip tint-amber text-[10px]" title="Carried from an earlier week">
            <RotateCcw className="w-3 h-3" aria-hidden /> carried
          </span>
        )}
        {row.doneAt ? (
          <span className="chip tint-emerald text-[10px]" title="Ticked off by the student">
            <CheckCircle2 className="w-3 h-3" aria-hidden /> Done
          </span>
        ) : (
          showReview &&
          row.state === "saved" && (
            <CoveragePill
              status={statusOfPoint(cov, activity.get(row.specPointId))}
              score={cov?.bestScore}
            />
          )
        )}
        {canChange && (
          <TutorRowMenu
            row={row}
            actions={actions}
            weekChoices={weekChoices}
            weekStart={state.weekStart}
          />
        )}
      </div>
    </li>
  );
}

/**
 * The open student's week: what they will do, filed by why it is there, with
 * one menu per row to change it. Nothing here needs explaining in a sentence
 * — the lane headings say "Course this week", "Revision", "Set by you" — so
 * the only prose is the one banner for a week the programme has not cut yet.
 */
export function TutorWeekTab({ state }: { state: TutorPlannerState }) {
  const { student, active, loading, lanes, rows, plan, projection, editable } = state;
  const { isCurrent, weekLabel, overridesAvailable, points, coverage, activity } = state;
  const { weekStart, currentWeek, shiftWeek, setWeek } = state;
  if (!student || !active) return null;
  const who = student.name ?? "The student";
  const uncut = editable && !!projection;
  // On a wide screen the roster beside this pane carries the week control; on
  // a phone the roster is hidden while a student is open, so it comes here.
  const switcher = (
    <WeekSwitcher
      weekStart={weekStart}
      currentWeek={currentWeek}
      onShift={shiftWeek}
      onToday={() => setWeek(currentWeek)}
      className="rounded-xl bg-muted/50 px-2.5 py-2 lg:hidden"
    />
  );
  if (loading)
    return (
      <div className="space-y-5">
        {switcher}
        <Spinner className="py-10" />
      </div>
    );

  return (
    <div className="space-y-5">
      {switcher}
      {uncut && (
        <p className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2.5 text-[12px] leading-relaxed">
          <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">
              {who} hasn't opened {isCurrent ? "this week" : "that week"} yet.
            </span>{" "}
            This is what the programme will set when they do. Anything you remove stays out, and
            anything you add stays in.
          </span>
        </p>
      )}
      {overridesAvailable === false && editable && <OverridesUnavailable />}

      <StatsStrip state={state} />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {editable
            ? `Nothing set or planned for ${weekLabel}.`
            : `No plan was set for ${weekLabel}.`}
        </p>
      ) : (
        lanes.map((lane) => (
          <section key={lane.key} aria-label={lane.title}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h3 className="text-sm font-bold">
                {lane.title}{" "}
                <span className="text-muted-foreground font-medium tabular-nums">{lane.count}</span>
              </h3>
              <p className="text-[11px] text-muted-foreground">{lane.hint}</p>
            </div>
            <div className="space-y-3">
              {lane.groups.map((g) => (
                <div key={g.topicId}>
                  {lane.groups.length > 1 || lane.key === "course" ? (
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                      {g.title}
                    </h4>
                  ) : null}
                  <ul className="space-y-1.5">
                    {g.rows.map((row) => (
                      <Row key={row.specPointId} row={row} state={state} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      <OverridesPanel state={state} />

      <WithheldPlanPoints points={state.week.withheld} coverage={state.week.coverage} />

      {editable && <AddPointsBox state={state} />}

      {state.showReview && plan && (
        <WeekReview
          studentId={student.id}
          plan={plan}
          points={points}
          coverage={coverage}
          activity={activity}
          subject={active.subject as SubjectV}
          board={active.board as BoardV}
          level={student.level ?? "gcse"}
          weekStart={weekStart}
          onChanged={() => void state.refreshAll()}
          readOnly
        />
      )}
    </div>
  );
}
