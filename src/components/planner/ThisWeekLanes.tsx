import { ReturningTopicInfo } from "./ReturningTopicInfo";
import { NothingDue } from "./NothingDue";
import { CatchUpWeek } from "./CatchUpWeek";
import { PLANNER_TIME_ZONE, weekKeyToDate } from "@/lib/planner/week";
import { Meter } from "@/components/Shared";
import { Link } from "@tanstack/react-router";
import { CircleDot, History, Repeat, CheckCircle2, Plus } from "lucide-react";
import { type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type PacingBand } from "@/lib/planner/pacing";
import { type PointCoverage } from "@/lib/planner/coverage";
import { type Activity } from "./useWeekPlan";
import { type TopicGroup } from "./useWeekLanes";
import { isDemoStudent } from "@/lib/demo/studentDemo";

/** Renders one spec point. The panel owns it, so every lane draws a point the same way. */
type Row = (p: PlanPoint) => React.ReactNode;

/** How much of the week's assigned practice is done, and the next piece to do. */
export function WeekProgressCard({
  assigned,
  completed,
  next,
  activity,
  coverage,
}: {
  assigned: PlanPoint[];
  completed: number;
  next: PlanPoint | undefined;
  activity: Activity;
  coverage: Map<string, PointCoverage>;
}) {
  return (
    <div className="premium-card tint-primary rounded-xl p-4 space-y-2">
      <h3 className="text-base font-bold">
        {completed === assigned.length
          ? "This week’s assigned practice is complete"
          : `${completed} of ${assigned.length} points practised`}
      </h3>
      <Meter value={(completed / assigned.length) * 100} size="sm" />
      {next && (
        <Link
          className="btn-solid inline-flex px-3 py-2 text-sm"
          to={
            activity.get(next.spec_point_id)?.hasHomework &&
            !coverage.get(next.spec_point_id)?.homeworkDone
              ? isDemoStudent()
                ? "/demo/student/homework"
                : "/homework"
              : isDemoStudent()
                ? "/demo/student/mcqs"
                : "/mcqs"
          }
        >
          Next: {next.title}
        </Link>
      )}
      {completed === assigned.length && (
        <p className="text-sm text-muted-foreground">
          Your results will guide future reviews. You can finish here for this week.
        </p>
      )}
    </div>
  );
}

/** Core topic — the curriculum, on schedule for the exam. */
export function NewLearningLane({
  band,
  covered,
  coreThisWeek,
  extraCore,
  row,
}: {
  band: PacingBand | null;
  covered: boolean;
  coreThisWeek: PlanPoint[];
  extraCore: TopicGroup[];
  row: Row;
}) {
  return (
    <div className="min-w-0 rounded-xl premium-card tint-primary p-4 bg-[color-mix(in_oklch,var(--tint)_4%,var(--card))]">
      <div className="flex items-center gap-1.5 mb-1">
        {covered ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="eyebrow eyebrow-bare text-xs tint-emerald">
              New learning · covered
            </span>
          </>
        ) : (
          <>
            <CircleDot className="w-3.5 h-3.5 text-primary" />
            <span className="eyebrow eyebrow-bare text-xs">New learning</span>
          </>
        )}
        {band && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {fmtRange(band.startWeek, band.endWeek)}
          </span>
        )}
      </div>

      {band || extraCore.length > 0 ? (
        <div className="space-y-5">
          {band && (
            <TopicBlock title={band.title} accent="primary">
              {coreThisWeek.length > 0 ? (
                <SpecPointList>{coreThisWeek.map(row)}</SpecPointList>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No new learning is assigned here this week.
                </p>
              )}
            </TopicBlock>
          )}
          {extraCore.map((g) => (
            <div key={g.topicId} className="border-t border-border pt-4">
              <TopicBlock title={g.title} accent="primary">
                <SpecPointList>{g.points.map(row)}</SpecPointList>
              </TopicBlock>
            </div>
          ))}
        </div>
      ) : (
        <NothingDue mascot="panda" mood="sleepy" title="No new topic this week" />
      )}
    </div>
  );
}

export function ReturningLane({
  returning,
  upcomingCatchUp,
  roadmap,
  weekStart,
  row,
}: {
  returning: TopicGroup[];
  upcomingCatchUp: boolean;
  roadmap: RoadmapResult | null;
  weekStart: string;
  row: Row;
}) {
  return (
    <section
      aria-label="Missed work returning"
      className="min-w-0 rounded-xl premium-card tint-amber p-4 bg-[color-mix(in_oklch,var(--tint)_4%,var(--card))]"
    >
      <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2 mb-3">
        <History className="size-4 shrink-0" /> Missed work returning
      </p>
      <div className="space-y-5">
        {returning.map((g) => (
          <TopicBlock
            key={g.topicId}
            title={g.title}
            accent="primary"
            header={
              <ReturningTopicInfo
                title={g.title}
                points={[
                  ...(roadmap?.catchUpSchedule?.weeks[weekStart] ?? []),
                  ...(roadmap?.backlog ?? []),
                ].filter(
                  (p, i, all) =>
                    g.points.some((point) => point.spec_point_id === p.specPointId) &&
                    all.findIndex((item) => item.specPointId === p.specPointId) === i,
                )}
              />
            }
          >
            <SpecPointList>{g.points.map(row)}</SpecPointList>
          </TopicBlock>
        ))}
        {upcomingCatchUp && (
          <CatchUpWeek schedule={roadmap?.catchUpSchedule} weekStart={weekStart} />
        )}
        {!returning.length && !upcomingCatchUp && (
          <NothingDue mascot="cat" title="Nothing to catch up" />
        )}
      </div>
    </section>
  );
}

export function RevisionLane({
  focus,
  focusPointCount,
  row,
}: {
  focus: TopicGroup[];
  focusPointCount: number;
  row: Row;
}) {
  return (
    <div className="min-w-0 rounded-xl premium-card tint-rose p-4 bg-[color-mix(in_oklch,var(--tint)_4%,var(--card))]">
      {focus.length > 0 ? (
        <>
          <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2 mb-3">
            <Repeat className="size-4" />
            Revision<span className="chip ml-auto text-xs">{focusPointCount} points</span>
          </p>
          <div className="space-y-5">
            {focus.map((g) => (
              <TopicBlock key={g.topicId} title={g.title} accent="rose">
                <SpecPointList>{g.points.map(row)}</SpecPointList>
              </TopicBlock>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2 mb-3">
            <Repeat className="size-4" />
            Revision
          </p>
          <NothingDue mascot="owl" mood="sleepy" title="No revision due" />
        </>
      )}
    </div>
  );
}

export function YoursLane({ yours, row }: { yours: TopicGroup[]; row: Row }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Plus className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="eyebrow eyebrow-bare tint-slate">Added by you</span>
      </div>
      <div className="space-y-5">
        {yours.map((g) => (
          <TopicBlock key={g.topicId} title={g.title} accent="muted">
            <SpecPointList>{g.points.map(row)}</SpecPointList>
          </TopicBlock>
        ))}
      </div>
    </div>
  );
}

function TopicBlock({
  title,
  children,
  header,
}: {
  title: string;
  accent: "primary" | "rose" | "muted";
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <div>
      {header ?? <h3 className="text-base font-bold leading-snug">{title}</h3>}
      {children}
    </div>
  );
}

/** The week's spec points stay visible directly beneath their topic. */
function SpecPointList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5 mt-3">{children}</div>;
}

/** "13 Jul – 16 Aug" for a band's week keys. */
function fmtRange(startWeek: string, endWeek: string): string {
  const fmt = (k: string) =>
    weekKeyToDate(k).toLocaleDateString(undefined, {
      timeZone: PLANNER_TIME_ZONE,
      day: "numeric",
      month: "short",
    });
  return `${fmt(startWeek)} – ${fmt(endWeek)}`;
}
