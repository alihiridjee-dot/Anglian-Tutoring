import { ReturningTopicInfo } from "./ReturningTopicInfo";
import { NothingDue } from "./NothingDue";
import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, History, Repeat } from "lucide-react";
import { EmptyState, SectionHeading } from "@/components/Shared";
import { DotWord, Tally, TINT_TEXT } from "./workbench/figures";
import type { RoadmapResult } from "@/lib/planner/roadmap";
import { isTeachBand, withWeeklyPoints } from "@/lib/planner/pacing";
import { byTopic } from "@/lib/planner/backlog";
import { breakCovering } from "@/lib/planner/breaks";
import { spineExamDate } from "@/lib/planner/topicOrder";
import { BreakWeek } from "./BreakWeek";
import {
  addWeeks,
  currentWeekKey,
  mondayOf,
  plannerDateLabel,
  toDateKey,
  weekKeyToDate,
  weekRangeLabel,
} from "@/lib/planner/week";
import { PointRow, BarePointRow } from "./PointRow";

/** A lane of a week: a stripe down its left side in the lane's colour. */
const LANE = "min-w-0 space-y-3 border-l-4 border-[color:var(--tint)] pl-4";
/**
 * A lane's name: its icon and word in the lane's colour, mixed darker than
 * `TINT_TEXT` so the amber lane still reads on white.
 */
const LANE_NAME =
  "font-display flex items-center gap-2 text-base font-extrabold text-[color:color-mix(in_oklab,var(--tint)_55%,var(--primary-deep))]";
/** The lanes drawn share the width on a wide screen, however many there are. */
const LANE_COLS = ["", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3"];

const dateLabel = (key: string) =>
  plannerDateLabel(weekKeyToDate(key), { day: "numeric", month: "long", year: "numeric" });

/** Month chapters retain the weekly plan and links back to original assignments. */
export function FullPlanTimeline({
  data,
  newFocusKeys,
  focusWeek,
}: {
  data: RoadmapResult;
  newFocusKeys: Set<string>;
  /** Opens on this week's month, scrolled to and highlighting the week. */
  focusWeek?: string;
}) {
  const now = currentWeekKey();
  const reviewing = data.needsAck && data.baselineBands.length > 0;
  // A moved exam date not applied yet: the plan the student had stays on
  // screen whole, up to the exam it was cut for, until the re-flow lands.
  const horizon = (reviewing && spineExamDate(data.baselineBands)) || data.examDate;
  // The exam date is stored as the day it falls on; the week it lands in is
  // keyed by its Monday, or a Wednesday exam never showed an "Exams" week.
  const examWeek = toDateKey(mondayOf(weekKeyToDate(horizon)));
  const viewport = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [expanded, setExpanded] = useState(new Set<string>());
  const [selectedMonth, setSelectedMonth] = useState((focusWeek ?? now).slice(0, 7));
  const [pendingJump, setPendingJump] = useState<string | null>(focusWeek ?? null);
  const [destination, setDestination] = useState<string | null>(focusWeek ?? null);
  const progress = new Map(data.progress.map((topic) => [topic.topicId, topic]));
  const missed = new Set(data.backlog.map((point) => point.specPointId));
  const assigned = new Set(data.catchUpSchedule?.assignedIds ?? []);
  const teaching = withWeeklyPoints(
    (reviewing ? (data.lastSeenBands ?? data.baselineBands) : data.bands).filter(isTeachBand),
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
    week <= horizon;
    week = toDateKey(addWeeks(weekKeyToDate(week), 1))
  )
    weeks.push(week);
  const months = [...new Set(weeks.map((week) => week.slice(0, 7)))];
  const activeMonth = months.includes(selectedMonth)
    ? selectedMonth
    : now < (weeks[0] ?? now)
      ? months[0]
      : months[months.length - 1];
  const monthIndex = months.indexOf(activeMonth);
  const monthWeeks = weeks.filter((week) => week.startsWith(activeMonth));
  const monthLabel = (month: string) =>
    plannerDateLabel(weekKeyToDate(`${month}-01`), { month: "long", year: "numeric" });
  const chooseMonth = (month: string) => {
    setSelectedMonth(month);
    setDestination(null);
    setPendingJump(null);
  };
  const toggle = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const jump = (week: string) => {
    if (!weeks.includes(week)) return;
    setSelectedMonth(week.slice(0, 7));
    setDestination(week);
    setPendingJump(week);
  };
  useEffect(() => {
    if (!pendingJump) return;
    const card = cards.current.get(pendingJump);
    if (card) {
      // The app bar is sticky and its height changes as it wraps on narrow screens.
      const bar = document.querySelector("header.sticky")?.getBoundingClientRect().bottom ?? 0;
      card.style.scrollMarginTop = `${Math.max(bar, 0) + 16}px`;
      card.scrollIntoView({ block: "start" });
      card.focus({ preventScroll: true });
      if (
        (pendingJump === now || pendingJump === focusWeek) &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        card.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.015)" }, { transform: "scale(1)" }],
          { duration: 500, iterations: 2, easing: "ease-in-out" },
        );
      setPendingJump(null);
    }
  }, [pendingJump, activeMonth, now, focusWeek]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = viewport.current?.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 180, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [activeMonth]);

  if (!months.length)
    return (
      <EmptyState
        compact
        title="Your plan is taking shape"
        body="Your weekly plan will appear once your course dates are set."
      />
    );

  return (
    <section className="space-y-4" aria-label="Full plan timeline">
      <SectionHeading title="Your weekly plan" />
      {/* The month sits on the page, not in a card: one plain line above it,
          the month large, and the highlighter stroke redrawn as it changes.
          The arrows and the month list are the quiet `btn-soft`; going back
          to this week is the one solid button. */}
      <div className="tint-primary flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[color:color-mix(in_oklab,var(--tint)_75%,var(--primary-deep))]">
            Your route to exams
          </p>
          <h3
            className="mt-1 text-2xl sm:text-3xl font-extrabold leading-[1.1]"
            aria-live="polite"
            aria-atomic="true"
          >
            {monthLabel(activeMonth)}
          </h3>
          <svg
            key={activeMonth}
            aria-hidden
            className="point-squiggle"
            viewBox="0 0 100 12"
            preserveAspectRatio="none"
          >
            <path d="M2 8 Q 18 1 34 7 T 66 6 T 98 5" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="flex flex-wrap w-full sm:w-auto items-center gap-2">
          <button
            type="button"
            aria-label="Previous month"
            disabled={monthIndex === 0}
            className="btn-soft inline-flex size-11 shrink-0 items-center justify-center rounded-xl disabled:cursor-not-allowed"
            onClick={() => chooseMonth(months[monthIndex - 1])}
          >
            <ChevronLeft className="size-5" strokeWidth={3} aria-hidden />
          </button>
          <div className="relative order-first w-full sm:order-none sm:w-auto">
            <select
              aria-label="Go to month"
              className="btn-soft w-full min-h-11 cursor-pointer appearance-none rounded-xl py-2 pl-4 pr-10 text-sm"
              value={activeMonth}
              onChange={(event) => chooseMonth(event.target.value)}
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                  {month === now.slice(0, 7) ? " · Now" : ""}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[color:color-mix(in_oklab,var(--tint)_70%,var(--primary-deep))]"
              strokeWidth={3}
              aria-hidden
            />
          </div>
          <button
            type="button"
            aria-label="Next month"
            disabled={monthIndex === months.length - 1}
            className="btn-soft inline-flex size-11 shrink-0 items-center justify-center rounded-xl order-2 ml-auto sm:order-none sm:ml-0 disabled:cursor-not-allowed"
            onClick={() => chooseMonth(months[monthIndex + 1])}
          >
            <ChevronRight className="size-5" strokeWidth={3} aria-hidden />
          </button>
          {weeks.includes(now) && (
            <button
              type="button"
              className="btn-solid inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm order-1 flex-1 sm:order-none sm:flex-none"
              onClick={() => jump(now)}
            >
              <span aria-hidden>📍</span> This week
            </button>
          )}
        </div>
      </div>
      <div
        ref={viewport}
        role="region"
        aria-label={`Weeks in ${monthLabel(activeMonth)}`}
        className="space-y-5"
      >
        {monthWeeks.map((week) => {
          const isPast = week < now;
          const isNow = week === now;
          const core = teaching.find((band) => band.startWeek <= week && band.endWeek >= week);
          const topic = core ? progress.get(core.topicId) : undefined;
          const refs = core?.pointsByWeek?.[week] ?? (core?.fixedPoints ? [] : undefined);
          const all = topic?.points ?? [];
          const weekly = refs
            ? all.filter((point) => refs.some((ref) => ref.specPointId === point.id))
            : all;
          const isCovered = !!core && data.coveredTopicIds.includes(core.topicId);
          const owing = weekly.filter((point) => missed.has(point.id)).length;
          const catchUp = byTopic(data.catchUpSchedule?.weeks[week] ?? []);
          const reviews = data.bands.filter(
            (band) => !isTeachBand(band) && band.startWeek <= week && band.endWeek >= week,
          );
          // Nothing is planned in a break week, so it shows the break, as
          // This week does, and no empty lanes.
          const onBreak = breakCovering(data.breaks ?? [], week);
          const lanes = Number(!!core) + Number(catchUp.length > 0) + Number(reviews.length > 0);
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
              className={`premium-card rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--tint)] outline-none ${isNow ? "tint-primary current-week" : "tint-slate"} ${destination === week && !isNow ? "ring-2 ring-[var(--tint)]" : ""}`}
            >
              <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
                <h3 className="text-lg font-extrabold">{weekRangeLabel(weekKeyToDate(week))}</h3>
                {(isNow || week >= examWeek) && (
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {isNow && (
                      <b className={`inline-flex items-center gap-1.5 ${TINT_TEXT}`}>
                        <span aria-hidden>📍</span> This week
                      </b>
                    )}
                    {week >= examWeek && (
                      <b className={`tint-rose inline-flex items-center gap-1.5 ${TINT_TEXT}`}>
                        <span aria-hidden>🎓</span> Exams
                      </b>
                    )}
                  </span>
                )}
              </header>
              {onBreak ? (
                <BreakWeek brk={onBreak} />
              ) : !lanes ? (
                // Nothing in any lane: one doodle for the week, not three.
                <div className="px-4 pb-4 sm:px-5">
                  {week >= examWeek ? (
                    <NothingDue mascot="panda" mood="proud" title="Exam time. Good luck!" />
                  ) : (
                    <NothingDue mascot="panda" mood="sleepy" title="No new topic this week" />
                  )}
                </div>
              ) : (
                // Each kind of work is a lane told apart by a stripe, an icon
                // and its name in one colour. A lane with nothing in it is not
                // drawn, and the lanes left share the width.
                <div className={`grid gap-6 p-4 sm:p-5 ${LANE_COLS[lanes]}`}>
                  {core && (
                    <section
                      className={`tint-primary ${LANE}`}
                      aria-label={`New learning for ${week}`}
                    >
                      <p className={LANE_NAME}>
                        <BookOpen className="size-5" aria-hidden />
                        {isPast ? "Scheduled learning" : "New learning"}
                      </p>
                      <h4 className="text-base font-bold leading-snug">{core.title}</h4>
                      {(isCovered || (isPast && owing > 0)) && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-bold">
                          {isCovered && <DotWord tint="tint-emerald">Topic covered</DotWord>}
                          {isPast && owing > 0 && (
                            <Tally n={owing} word="to catch up" tint="tint-amber" />
                          )}
                        </div>
                      )}
                      {weekly.length > 0 && (
                        <ul className="space-y-3">
                          {weekly.map((point) => (
                            <PointRow
                              key={point.id}
                              point={point}
                              card
                              missed={isPast && missed.has(point.id)}
                            />
                          ))}
                        </ul>
                      )}
                    </section>
                  )}
                  {catchUp.length > 0 && (
                    <section
                      className={`tint-amber ${LANE}`}
                      aria-label={`Missed work returning for ${week}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <p className={LANE_NAME}>
                          <History className="size-5" aria-hidden />
                          Missed work returning
                        </p>
                        <span className="text-sm font-bold">
                          <DotWord tint="tint-amber">
                            {isNow &&
                            catchUp.every((group) =>
                              group.points.every((point) => assigned.has(point.specPointId)),
                            )
                              ? "Assigned this week"
                              : "Expected this week"}
                          </DotWord>
                        </span>
                      </div>
                      {catchUp.map((group) => (
                        <div key={group.topicId} className="space-y-3">
                          <ReturningTopicInfo
                            title={group.topicTitle}
                            points={group.points}
                            onOriginalWeek={jump}
                          />
                          <ul className="space-y-3">
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
                  {reviews.length > 0 && (
                    <section className={`tint-rose ${LANE}`} aria-label={`Revision for ${week}`}>
                      <p className={LANE_NAME}>
                        <Repeat className="size-5" aria-hidden />
                        Revision
                      </p>
                      {reviews.map((band) => {
                        const bandKey = `${band.topicId}|${band.kind}|${band.startWeek}`;
                        const key = `${bandKey}@${week}`;
                        const items = progress.get(band.topicId)?.points ?? [];
                        const byId = new Map(items.map((point) => [point.id, point]));
                        const rows =
                          expanded.has(`${key}@all`) || !band.points?.length
                            ? items.map((point) => ({ point, ref: null }))
                            : band.points.map((ref) => ({
                                point: byId.get(ref.specPointId),
                                ref,
                              }));
                        // The points due are shown, not folded away; the
                        // button swaps them for the whole topic and back.
                        return (
                          <div key={key} className="space-y-3">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <h4 className="text-base font-bold leading-snug">{band.title}</h4>
                              {newFocusKeys.has(bandKey) && (
                                <span className="text-sm font-bold">
                                  <DotWord tint="tint-pop">New</DotWord>
                                </span>
                              )}
                            </div>
                            <ul className="space-y-3">
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
                            {!!band.points?.length && (
                              <button
                                className="btn-soft inline-flex min-h-11 items-center rounded-xl px-3 text-sm sm:pointer-fine:min-h-9"
                                type="button"
                                onClick={() => toggle(`${key}@all`)}
                              >
                                {expanded.has(`${key}@all`)
                                  ? "Show due points"
                                  : "Show whole topic"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </section>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
