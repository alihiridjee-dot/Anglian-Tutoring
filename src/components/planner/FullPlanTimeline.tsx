import { ReturningTopicInfo } from "./ReturningTopicInfo";
import { EmptyRevision } from "./EmptyRevision";
import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ChevronDown, History, Repeat } from "lucide-react";
import { SectionHeading } from "@/components/Shared";
import type { RoadmapResult } from "@/lib/programDal";
import { isTeachBand, withWeeklyPoints } from "@/lib/planner/pacing";
import { byTopic } from "@/lib/planner/backlog";
import {
  addWeeks,
  currentWeekKey,
  plannerDateLabel,
  toDateKey,
  weekKeyToDate,
  weekRangeLabel,
} from "@/lib/week";
import { PointRow, BarePointRow } from "./PointRow";
import { PacingChangeBadge } from "./PacingChangeBadge";

const dateLabel = (key: string) =>
  plannerDateLabel(weekKeyToDate(key), { day: "numeric", month: "long", year: "numeric" });

/** One continuous history, opening at today, with the reason for each kind of work visible. */
export function FullPlanTimeline({
  data,
  newFocusKeys,
}: {
  data: RoadmapResult;
  newFocusKeys: Set<string>;
}) {
  const now = currentWeekKey();
  const viewport = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [expanded, setExpanded] = useState(new Set<string>());
  const [selectedMonth, setSelectedMonth] = useState(now.slice(0, 7));
  const [destination, setDestination] = useState<string | null>(null);
  const progress = new Map(data.progress.map((topic) => [topic.topicId, topic]));
  const missed = new Set(data.backlog.map((point) => point.specPointId));
  const assigned = new Set(data.catchUpSchedule?.assignedIds ?? []);
  const reviewing = data.needsAck && data.baselineBands.length > 0;
  const teaching = withWeeklyPoints(
    (reviewing ? data.baselineBands : data.bands).filter(isTeachBand),
    new Map(
      data.progress.map((topic) => [
        topic.topicId,
        topic.points.map((p) => ({
          specPointId: p.id,
          code: p.code,
          title: p.title,
          weight: p.weight,
        })),
      ]),
    ),
  );
  const weeks: string[] = [];
  for (
    let week = data.programStart;
    week <= data.examDate;
    week = toDateKey(addWeeks(weekKeyToDate(week), 1))
  )
    weeks.push(week);
  const months = [...new Set(weeks.map((week) => week.slice(0, 7)))];
  const toggle = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const jump = (week: string, originalTopic?: string) => {
    const card = cards.current.get(week);
    const container = viewport.current;
    if (!card || !container) return;
    if (originalTopic)
      setExpanded((previous) => new Set([...previous, `${originalTopic}@${week}`]));
    setDestination(week);
    setSelectedMonth(week.slice(0, 7));
    container.scrollTop +=
      card.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
    card.focus({ preventScroll: true });
  };
  useEffect(() => {
    const container = viewport.current;
    const initial = cards.current.get(now) ?? cards.current.values().next().value;
    if (container && initial) {
      container.scrollTop +=
        initial.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
      setSelectedMonth(initial.dataset.week!.slice(0, 7));
    }
  }, [now, data.programStart]);

  return (
    <section className="space-y-4" aria-label="Full plan timeline">
      <SectionHeading
        title="Your weekly plan"
        hint="Scroll up for earlier weeks, down for what’s next."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          Go to
          <select
            aria-label="Go to month"
            className="premium-card rounded-lg px-3 py-2 text-sm max-w-full"
            value={selectedMonth}
            onChange={(event) => jump(weeks.find((week) => week.startsWith(event.target.value))!)}
          >
            {months.map((month) => (
              <option key={month} value={month}>
                {plannerDateLabel(weekKeyToDate(`${month}-01`), { month: "long", year: "numeric" })}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-premium rounded-lg px-3 py-2 text-sm"
          onClick={() => jump(weeks.includes(now) ? now : weeks[weeks.length - 1])}
        >
          Jump to this week
        </button>
      </div>
      <div
        ref={viewport}
        data-planner-scroll
        role="region"
        aria-label="Weeks from enrolment to exams"
        tabIndex={0}
        className="relative max-h-[70vh] min-h-80 overflow-y-auto overscroll-contain rounded-xl bg-muted/30 px-3 py-4 sm:px-5 space-y-5 focus-visible:outline-2 focus-visible:outline-primary"
        onScroll={() => {
          const container = viewport.current;
          if (!container) return;
          const top = container.getBoundingClientRect().top;
          const visible = [...cards.current.values()].find(
            (card) => card.getBoundingClientRect().bottom > top + 60,
          );
          if (visible) setSelectedMonth(visible.dataset.week!.slice(0, 7));
        }}
      >
        {weeks.map((week) => {
          const isPast = week < now;
          const isNow = week === now;
          const core = teaching.find((band) => band.startWeek <= week && band.endWeek >= week);
          const topic = core ? progress.get(core.topicId) : undefined;
          const rowKey = `${core?.topicId}@${week}`;
          const refs = core?.pointsByWeek?.[week] ?? (core?.fixedPoints ? [] : undefined);
          const all = topic?.points ?? [];
          const weekly = refs
            ? all.filter((point) => refs.some((ref) => ref.specPointId === point.id))
            : all;
          const shown = expanded.has(`${rowKey}@all`) ? all : weekly;
          const owing = weekly.filter((point) => missed.has(point.id)).length;
          const catchUp = byTopic(data.catchUpSchedule?.weeks[week] ?? []);
          const reviews = data.bands.filter(
            (band) => !isTeachBand(band) && band.startWeek <= week && band.endWeek >= week,
          );
          const proposed = reviewing
            ? data.bands.find(
                (band) => isTeachBand(band) && band.startWeek <= week && band.endWeek >= week,
              )
            : undefined;
          const change = proposed
            ? data.changes.find(
                (c) => c.topicId === proposed.topicId && proposed.startWeek === week,
              )
            : undefined;
          return (
            <article
              key={week}
              data-week={week}
              aria-label={`Week of ${dateLabel(week)}`}
              tabIndex={-1}
              ref={(element) => {
                if (element) cards.current.set(week, element);
                else cards.current.delete(week);
              }}
              className={`premium-card rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--tint)] outline-none ${isNow ? "tint-primary" : "tint-slate"} ${destination === week ? "ring-2 ring-[var(--tint)]" : ""}`}
            >
              <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-5 border-b border-border">
                <h3 className="text-base font-bold">{weekRangeLabel(weekKeyToDate(week))}</h3>
                <span className="chip text-xs">
                  {isNow ? "This week" : isPast ? "Earlier week" : "Upcoming"}
                </span>
              </header>
              <div className="divide-y divide-border">
                <section
                  className="px-4 py-4 sm:px-5 space-y-3 tint-primary"
                  aria-label={`New learning for ${week}`}
                >
                  <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2">
                    <BookOpen className="size-4" />
                    {isPast ? "Scheduled learning" : "New learning"}
                  </p>
                  {core ? (
                    <>
                      <button
                        type="button"
                        className="flex items-start justify-between gap-3 w-full text-left"
                        aria-expanded={expanded.has(rowKey)}
                        onClick={() => toggle(rowKey)}
                      >
                        <span>
                          <span className="block text-base font-bold">{core.title}</span>
                          <span className="block mt-1 text-xs text-muted-foreground">
                            {weekly.length} spec points ·{" "}
                            {expanded.has(rowKey) ? "Hide details" : "View points & results"}
                          </span>
                        </span>
                        <ChevronDown
                          className={`size-4 shrink-0 mt-1 ${expanded.has(rowKey) ? "rotate-180" : ""}`}
                        />
                      </button>
                      {data.coveredTopicIds.includes(core.topicId) && (
                        <span className="chip tint-emerald text-xs">
                          <CheckCircle2 className="size-3" /> Topic covered
                        </span>
                      )}
                      {isPast && owing > 0 && (
                        <p className="text-sm text-muted-foreground">
                          {owing} {owing === 1 ? "point still needs" : "points still need"}{" "}
                          covering. Missed work returns in later weeks.
                        </p>
                      )}
                      {expanded.has(rowKey) && (
                        <div className="space-y-2">
                          {weekly.length < all.length && (
                            <button
                              type="button"
                              className="btn-premium rounded-lg px-2 py-1 text-xs"
                              onClick={() => toggle(`${rowKey}@all`)}
                            >
                              {expanded.has(`${rowKey}@all`)
                                ? "Show this week only"
                                : "Show whole topic"}
                            </button>
                          )}
                          <ul className="space-y-1.5">
                            {shown.map((point) => (
                              <PointRow key={point.id} point={point} card />
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {week >= data.examDate ? "Exam period begins." : "No new learning scheduled."}
                    </p>
                  )}
                </section>
                {catchUp.length > 0 && (
                  <section
                    className="px-4 py-4 sm:px-5 space-y-3 tint-amber"
                    aria-label={`Missed work returning for ${week}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2">
                        <History className="size-4" />
                        Missed work returning
                      </p>
                      <span className="chip text-xs">
                        {isNow &&
                        catchUp.every((group) =>
                          group.points.every((point) => assigned.has(point.specPointId)),
                        )
                          ? "Assigned this week"
                          : "Expected this week"}
                      </span>
                    </div>
                    {catchUp.map((group) => (
                      <div key={group.topicId} className="space-y-3">
                        <ReturningTopicInfo
                          title={group.topicTitle}
                          points={group.points}
                          estimated={week > now}
                          onOriginalWeek={jump}
                        />
                        <ul className="space-y-1.5">
                          {group.points.map((point) => {
                            const assessed = progress
                              .get(group.topicId)
                              ?.points.find((p) => p.id === point.specPointId);
                            return assessed ? (
                              <PointRow key={point.specPointId} point={assessed} card />
                            ) : (
                              <BarePointRow
                                key={point.specPointId}
                                code={point.code}
                                title={point.title}
                                card
                              />
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </section>
                )}
                <section
                  className="px-4 py-3 sm:px-5 space-y-3 tint-rose"
                  aria-label={`Revision for ${week}`}
                >
                  {reviews.length ? (
                    <>
                      <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2">
                        <Repeat className="size-4" />
                        Revision
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Previously assessed work, due for another review.
                        {week > now ? " Future review dates are estimates." : ""}
                      </p>
                      {reviews.map((band) => {
                        const bandKey = `${band.topicId}|${band.kind}|${band.startWeek}`;
                        const key = `${bandKey}@${week}`;
                        const items = progress.get(band.topicId)?.points ?? [];
                        const byId = new Map(items.map((point) => [point.id, point]));
                        const rows =
                          expanded.has(`${key}@all`) || !band.points?.length
                            ? items.map((point) => ({ point, ref: null }))
                            : band.points.map((ref) => ({ point: byId.get(ref.specPointId), ref }));
                        return (
                          <details key={key} className="text-sm">
                            <summary className="cursor-pointer text-base font-bold leading-snug">
                              {band.title}{" "}
                              {newFocusKeys.has(bandKey) && (
                                <span className="chip text-xs">New</span>
                              )}
                            </summary>
                            <button
                              className="btn-premium rounded-lg px-2 py-1 my-2 text-xs"
                              type="button"
                              onClick={() => toggle(`${key}@all`)}
                            >
                              {expanded.has(`${key}@all`) ? "Show due points" : "Show whole topic"}
                            </button>
                            <ul className="space-y-1.5">
                              {rows.map(({ point, ref }) =>
                                point ? (
                                  <PointRow key={point.id} point={point} card />
                                ) : (
                                  ref && (
                                    <BarePointRow
                                      key={ref.specPointId}
                                      code={ref.code}
                                      title={ref.title}
                                      card
                                    />
                                  )
                                ),
                              )}
                            </ul>
                          </details>
                        );
                      })}
                    </>
                  ) : (
                    <EmptyRevision isPast={isPast} />
                  )}
                </section>
                {reviewing && (
                  <section
                    className="tint-amber px-4 py-4 sm:px-5 space-y-2"
                    aria-label={`Proposed learning for ${week}`}
                  >
                    <p className="eyebrow eyebrow-bare text-xs">Proposed learning</p>
                    <p className="text-sm font-bold">{proposed?.title ?? "No new learning"}</p>
                    <p className="text-xs text-muted-foreground">
                      {proposed?.topicId === core?.topicId
                        ? "Same topic as your current plan."
                        : "Only changes if you accept the new plan."}
                    </p>
                    {change && <PacingChangeBadge change={change} />}
                  </section>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
