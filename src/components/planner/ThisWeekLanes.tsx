import { ReturningTopicInfo } from "./ReturningTopicInfo";
import { NothingDue } from "./NothingDue";
import { CatchUpWeek } from "./CatchUpWeek";
import { PLANNER_TIME_ZONE, weekKeyToDate, weekRangeLabel } from "@/lib/planner/week";
import { Meter } from "@/components/Shared";
import {
  CircleDot,
  History,
  Repeat,
  CheckCircle2,
  Plus,
  BookMarked,
  Lock,
  Trophy,
} from "lucide-react";
import { type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type PacingBand } from "@/lib/planner/pacing";
import { type ReviewLock } from "@/lib/planner/reviewLock";
import { type TopicGroup } from "./useWeekLanes";

/** Renders one spec point. The panel owns it, so every lane draws a point the same way. */
type Row = (p: PlanPoint) => React.ReactNode;

/**
 * How much of the week's assigned practice is done, and when the week in review
 * opens — the one progress card on the week.
 */
export function WeekProgressCard({
  total,
  completed,
  lock,
}: {
  /** Every point of the week, as the weekly task list counts them. */
  total: number;
  completed: number;
  lock: ReviewLock;
}) {
  const done = completed === total;
  return (
    <div className="premium-card tint-primary rounded-xl p-4 space-y-2">
      <h3 className="text-base font-bold">
        {done ? "This week’s points are all done" : `${completed} of ${total} points done`}
      </h3>
      {/* The bar runs up to where the week has got to; the trophy is the end of it. */}
      <div className="flex items-center gap-3">
        <Meter
          key={completed}
          value={(completed / total) * 100}
          size="lg"
          fillIn
          className="min-w-0 flex-1"
        />
        <Trophy
          aria-hidden
          className={
            done
              ? "pop-in size-6 shrink-0 text-[color:var(--tint)]"
              : "size-6 shrink-0 text-[color:color-mix(in_oklab,var(--tint)_35%,transparent)]"
          }
        />
      </div>
      {lock.locked && (
        <p className="flex items-start gap-2 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-[color:var(--tint)]" aria-hidden />
          <span>
            Your week in review opens{" "}
            {lock.opensOn.toLocaleDateString("en-GB", {
              timeZone: PLANNER_TIME_ZONE,
              weekday: "long",
              day: "numeric",
              month: "short",
            })}
          </span>
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
  // A topic with no points this week is not drawn.
  const shownBand = coreThisWeek.length > 0 ? band : null;
  return (
    <div
      data-guide="lane-new"
      className="min-w-0 rounded-xl premium-card tint-primary p-4 bg-[color-mix(in_oklch,var(--tint)_4%,var(--card))]"
    >
      <div className="flex items-center gap-1.5 mb-1">
        {covered ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 tint-emerald text-[color:var(--tint)]" />
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
        {shownBand && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {fmtRange(shownBand.startWeek, shownBand.endWeek)}
          </span>
        )}
      </div>

      {shownBand || extraCore.length > 0 ? (
        <div className="space-y-5">
          {shownBand && (
            <TopicBlock title={shownBand.title} accent="primary">
              <SpecPointList>{coreThisWeek.map(row)}</SpecPointList>
            </TopicBlock>
          )}
          {extraCore.map((g, i) => (
            <div
              key={g.topicId}
              className={shownBand || i > 0 ? "border-t border-border pt-4" : undefined}
            >
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
      data-guide="lane-returning"
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
    <div
      data-guide="lane-revision"
      className="min-w-0 rounded-xl premium-card tint-rose p-4 bg-[color-mix(in_oklch,var(--tint)_4%,var(--card))]"
    >
      {focus.length > 0 ? (
        <>
          <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2 mb-3">
            <Repeat className="size-4" />
            Revision
            <span className="chip ml-auto text-xs">
              {focusPointCount} {focusPointCount === 1 ? "point" : "points"}
            </span>
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

/** Points a tutor pinned into this student's week, kept apart from the student's own. */
export function TutorLane({ tutor, row }: { tutor: TopicGroup[]; row: Row }) {
  return (
    <div className="tint-accent rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <BookMarked className="w-3.5 h-3.5 text-[color:var(--tint)]" />
        <span className="eyebrow eyebrow-bare">From your tutor</span>
      </div>
      <div className="space-y-5">
        {tutor.map((g) => (
          <TopicBlock key={g.topicId} title={g.title} accent="muted">
            <SpecPointList>{g.points.map(row)}</SpecPointList>
          </TopicBlock>
        ))}
      </div>
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

/** "13 Jul – 16 Aug 2026" for a band's week keys: its first Monday to its last Sunday. */
function fmtRange(startWeek: string, endWeek: string): string {
  return weekRangeLabel(weekKeyToDate(startWeek), weekKeyToDate(endWeek));
}
