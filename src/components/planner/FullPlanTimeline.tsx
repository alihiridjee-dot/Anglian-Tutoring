import { ReturningTopicInfo } from "./ReturningTopicInfo";
import { NothingDue } from "./NothingDue";
import { useEffect, useId, useRef, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  History,
  Repeat,
} from "lucide-react";
import { EmptyState, SectionHeading } from "@/components/Shared";
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
import { useEntryState } from "@/hooks/useEntryState";

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
  // Every week but this one is folded until it is opened (Ali, 25 Nov 2026).
  // Kept with the visit, so Back from a point finds the weeks as they were left.
  const [openWeeks, setOpenWeeks] = useEntryState<string[]>(
    "planner.openWeeks",
    focusWeek ? [focusWeek] : [],
  );
  const bodyId = useId();
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
  const toggleWeek = (week: string) =>
    setOpenWeeks((open) =>
      open.includes(week) ? open.filter((key) => key !== week) : [...open, week],
    );
  const jump = (week: string) => {
    if (!weeks.includes(week)) return;
    // A jump lands on the week opened, or it would land on a bare date.
    setOpenWeeks((open) => (open.includes(week) ? open : [...open, week]));
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
      <div className="premium-card tint-primary rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow eyebrow-bare text-xs">Your route to exams</p>
            <h3
              className="text-xl sm:text-3xl font-bold mt-2"
              aria-live="polite"
              aria-atomic="true"
            >
              {monthLabel(activeMonth)}
            </h3>
          </div>
          <div className="flex flex-wrap w-full sm:w-auto items-center gap-2">
            <button
              type="button"
              aria-label="Previous month"
              disabled={monthIndex === 0}
              className="btn-premium rounded-lg p-3 sm:pointer-fine:p-2 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => chooseMonth(months[monthIndex - 1])}
            >
              <ChevronLeft className="size-5" />
            </button>
            <select
              aria-label="Go to month"
              className="premium-card rounded-lg px-3 py-2 min-h-11 sm:pointer-fine:min-h-0 text-xs sm:text-sm order-first w-full sm:order-none sm:w-auto"
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
            <button
              type="button"
              aria-label="Next month"
              disabled={monthIndex === months.length - 1}
              className="btn-premium rounded-lg p-3 sm:pointer-fine:p-2 order-2 ml-auto sm:order-none sm:ml-0 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => chooseMonth(months[monthIndex + 1])}
            >
              <ChevronRight className="size-5" />
            </button>
            {weeks.includes(now) && (
              <button
                type="button"
                className="btn-premium rounded-lg px-2 sm:px-3 py-2 min-h-11 sm:pointer-fine:min-h-0 text-xs sm:text-sm inline-flex items-center gap-1.5 whitespace-nowrap justify-center order-1 flex-1 sm:order-none sm:flex-none"
                onClick={() => jump(now)}
              >
                <CalendarDays className="size-4 hidden sm:block" aria-hidden />
                This week
              </button>
            )}
          </div>
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
          const isOpen = isNow || openWeeks.includes(week);
          const title = weekRangeLabel(weekKeyToDate(week));
          const chips = (isNow || week >= examWeek) && (
            <span className="flex flex-wrap gap-1.5">
              {isNow && <span className="chip chip-solid text-xs">This week</span>}
              {week >= examWeek && (
                <span className="chip tint-rose text-xs">
                  <GraduationCap className="size-3.5" aria-hidden /> Exams
                </span>
              )}
            </span>
          );
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
              <header className={isOpen ? "border-b border-border" : undefined}>
                {isNow ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-5">
                    <h3 className="text-base font-bold">{title}</h3>
                    {chips}
                  </div>
                ) : (
                  <h3 className="text-base font-bold">
                    <button
                      type="button"
                      onClick={() => toggleWeek(week)}
                      aria-expanded={isOpen}
                      aria-controls={`${bodyId}-${week}`}
                      className="flex w-full flex-wrap items-center gap-2 px-4 py-4 sm:px-5 text-left"
                    >
                      <span className="min-w-0 flex-1">{title}</span>
                      {chips}
                      <ChevronDown
                        className={`size-5 shrink-0 text-[color:var(--tint)] transition-transform ${isOpen ? "" : "-rotate-90"}`}
                        aria-hidden
                      />
                    </button>
                  </h3>
                )}
              </header>
              <div id={`${bodyId}-${week}`} hidden={!isOpen}>
                {onBreak ? (
                  <BreakWeek brk={onBreak} />
                ) : (
                  <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-3">
                    <section
                      className="min-w-0 premium-card rounded-xl p-4 space-y-3 tint-primary bg-[color-mix(in_oklch,var(--tint)_4%,var(--card))]"
                      aria-label={`New learning for ${week}`}
                    >
                      <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2">
                        <BookOpen className="size-4" />
                        {isPast ? "Scheduled learning" : "New learning"}
                      </p>
                      {core ? (
                        <>
                          <h4 className="text-base font-bold leading-snug">{core.title}</h4>
                          {(isCovered || (isPast && owing > 0)) && (
                            <div className="flex flex-wrap gap-1.5">
                              {isCovered && (
                                <span className="chip tint-emerald text-xs">
                                  <CheckCircle2 className="size-3" aria-hidden /> Topic covered
                                </span>
                              )}
                              {isPast && owing > 0 && (
                                <span className="chip tint-amber text-xs">
                                  <History className="size-3" aria-hidden /> {owing} to catch up
                                </span>
                              )}
                            </div>
                          )}
                          {weekly.length > 0 && (
                            <ul className="space-y-1.5">
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
                        </>
                      ) : week >= examWeek ? (
                        <NothingDue mascot="panda" mood="proud" title="Exam time. Good luck!" />
                      ) : (
                        <NothingDue mascot="panda" mood="sleepy" title="No new topic this week" />
                      )}
                    </section>
                    <section
                      className="min-w-0 premium-card rounded-xl p-4 space-y-3 tint-amber bg-[color-mix(in_oklch,var(--tint)_4%,var(--card))]"
                      aria-label={`Missed work returning for ${week}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2">
                          <History className="size-4" />
                          Missed work returning
                        </p>
                        {catchUp.length > 0 && (
                          <span className="chip text-xs">
                            {isNow &&
                            catchUp.every((group) =>
                              group.points.every((point) => assigned.has(point.specPointId)),
                            )
                              ? "Assigned this week"
                              : "Expected this week"}
                          </span>
                        )}
                      </div>
                      {!catchUp.length && <NothingDue mascot="cat" title="Nothing to catch up" />}
                      {catchUp.map((group) => (
                        <div key={group.topicId} className="space-y-3">
                          <ReturningTopicInfo
                            title={group.topicTitle}
                            points={group.points}
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
                    <section
                      className="min-w-0 premium-card rounded-xl p-4 space-y-3 tint-rose bg-[color-mix(in_oklch,var(--tint)_4%,var(--card))]"
                      aria-label={`Revision for ${week}`}
                    >
                      <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2">
                        <Repeat className="size-4" />
                        Revision
                      </p>
                      {reviews.length ? (
                        <>
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
                            return (
                              <details key={key} className="text-sm">
                                <summary className="cursor-pointer text-base font-bold leading-snug py-2.5 -my-2.5 sm:pointer-fine:py-0 sm:pointer-fine:my-0">
                                  {band.title}{" "}
                                  {newFocusKeys.has(bandKey) && (
                                    <span className="chip text-xs">New</span>
                                  )}
                                </summary>
                                <button
                                  className="btn-premium rounded-lg px-2 py-1 my-2 min-h-11 sm:pointer-fine:min-h-0 text-xs"
                                  type="button"
                                  onClick={() => toggle(`${key}@all`)}
                                >
                                  {expanded.has(`${key}@all`)
                                    ? "Show due points"
                                    : "Show whole topic"}
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
                        <NothingDue mascot="owl" mood="sleepy" title="No revision due" />
                      )}
                    </section>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
