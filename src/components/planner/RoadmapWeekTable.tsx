import { CatchUpWeek } from "./CatchUpWeek";
import type { CatchUpSchedule } from "@/lib/planner/backlog";
import {
  Loader2,
  CheckCircle2,
  CircleDot,
  ChevronDown,
  CalendarDays,
  RefreshCw,
} from "lucide-react";
import { type PacingBand, type PacingChange } from "@/lib/planner/pacing";
import { type TopicProgress } from "@/lib/planner/scheduleDal";
import { currentWeekKey, weekKeyToDate } from "@/lib/planner/week";
import { PointRow } from "./PointRow";
import { FocusedTopicsHeaderCell, FocusPointsPanel, FocusTopicButton } from "./FocusLane";
import { focusHasDetail, focusRowKey } from "./focusMeta";
import { PacingChangeBadge } from "./PacingChangeBadge";
import { type BacklogPoint } from "@/lib/planner/backlog";
import { fmtDate, weekKeysBetween } from "./roadmapWeeks";

const inBand = (b: PacingBand, wk: string) => b.startWeek <= wk && wk <= b.endWeek;

/**
 * The programme as a week-by-week table. The date leads each row; alongside it
 * sit that week's core topic (the class's chronological spine) and any focused
 * topics (the FSRS-driven revisits that resurface until they stick). It runs the
 * whole year from this week to the exams, and scrolls. Core topics stay
 * expandable to their spec-point breakdown.
 */
export function WeekTable({
  spine,
  proposedSpine,
  onAccept,
  accepting,
  focusBands,
  programStart,
  showHistory,
  owedByWeek,
  catchUpSchedule,
  examDate,
  covered,
  progressByTopic,
  masteryByTopic,
  changeByTopic,
  expanded,
  onToggle,
}: {
  /** The spine to show in the Core column — the accepted plan while reviewing. */
  spine: PacingBand[];
  /** The re-flowed spine awaiting acceptance, or null when there is nothing to review. */
  proposedSpine: PacingBand[] | null;
  /** Accept the proposal. Null in tutor mode — the gesture is the student's. */
  onAccept: (() => void) | null;
  accepting: boolean;
  focusBands: PacingBand[];
  /** The programme's anchor week — where the table starts once history is shown. */
  programStart: string;
  showHistory: boolean;
  /** Week → the points promised in it that are still outstanding ([[backlog]]). */
  owedByWeek: Map<string, BacklogPoint[]>;
  catchUpSchedule?: CatchUpSchedule;
  examDate: string;
  covered: Set<string>;
  progressByTopic: Map<string, TopicProgress>;
  masteryByTopic: Map<string, number>;
  /** Topic id → its reschedule, so moved topics are flagged at their start week. */
  changeByTopic: Map<string, PacingChange>;
  expanded: Set<string>;
  onToggle: (topicId: string) => void;
}) {
  const nowKey = currentWeekKey();
  /**
   * The programme's whole run, or just the road ahead.
   *
   * This used to be unconditionally `weekKeysBetween(nowKey, examDate)`, and
   * that single line was why a topic whose band had closed could not be seen at
   * all: not filtered as finished, not marked as missed — simply outside the
   * window, while the header above went on counting it in "N of 9 topics
   * covered". A student four weeks past Topic 1 had no way to reach it.
   */
  const weeks = weekKeysBetween(showHistory ? programStart : nowKey, examDate);

  // The proposal rides in a fourth column that exists only while there is
  // something to accept, so the layout returns to three once it is gone.
  const cols = proposedSpine
    ? "grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.05fr)]"
    : "grid-cols-[7.5rem_1fr_1fr]";

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div
        className={`grid ${cols} bg-muted/50 border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}
      >
        <div className="flex items-center gap-1.5 px-3 py-2">
          <CalendarDays className="w-3.5 h-3.5" /> Week
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 border-l border-border">
          <CircleDot className="w-3.5 h-3.5 text-primary" />
          {proposedSpine ? "Core topics · now" : "Core topics"}
        </div>
        <FocusedTopicsHeaderCell />
        {proposedSpine && (
          <div className="flex items-center gap-2 px-3 py-2 border-l-2 border-l-amber-500 bg-amber-500/[0.07]">
            <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <RefreshCw className="w-3.5 h-3.5" /> Proposed
            </span>
            {onAccept && (
              <button
                type="button"
                onClick={onAccept}
                disabled={accepting}
                className="ml-auto inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-amber-600 text-white text-[10px] font-bold uppercase tracking-wide hover:opacity-90 disabled:opacity-50"
              >
                {accepting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                Accept
              </button>
            )}
          </div>
        )}
      </div>

      <div className="max-h-[32rem] overflow-y-auto divide-y divide-border">
        {weeks.map((wk) => (
          <RoadmapWeekRow
            key={wk}
            wk={wk}
            nowKey={nowKey}
            cols={cols}
            spine={spine}
            proposedSpine={proposedSpine}
            focusBands={focusBands}
            owedByWeek={owedByWeek}
            catchUpSchedule={catchUpSchedule}
            covered={covered}
            progressByTopic={progressByTopic}
            masteryByTopic={masteryByTopic}
            changeByTopic={changeByTopic}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

/** One week of the programme: its date, core topic, focused topics, and whatever is opened beneath. */
function RoadmapWeekRow({
  wk,
  nowKey,
  cols,
  spine,
  proposedSpine,
  focusBands,
  owedByWeek,
  catchUpSchedule,
  covered,
  progressByTopic,
  masteryByTopic,
  changeByTopic,
  expanded,
  onToggle,
}: {
  wk: string;
  nowKey: string;
  /** The grid template, which gains a column while there is a proposal to review. */
  cols: string;
  spine: PacingBand[];
  proposedSpine: PacingBand[] | null;
  focusBands: PacingBand[];
  owedByWeek: Map<string, BacklogPoint[]>;
  catchUpSchedule?: CatchUpSchedule;
  covered: Set<string>;
  progressByTopic: Map<string, TopicProgress>;
  masteryByTopic: Map<string, number>;
  changeByTopic: Map<string, PacingChange>;
  expanded: Set<string>;
  onToggle: (topicId: string) => void;
}) {
  const isNow = wk === nowKey;
  // Date-keys are YYYY-MM-DD, so a lexical compare is a chronological one.
  const isPast = wk < nowKey;
  const owed = owedByWeek.get(wk) ?? [];
  const core = spine.find((b) => inBand(b, wk));
  const focused = focusBands.filter((b) => inBand(b, wk));
  const tp = core ? progressByTopic.get(core.topicId) : undefined;
  // Expansion is per ROW, not per topic: a topic spans several weeks and
  // each one teaches a different slice, so opening "Topic 1" in October
  // must not also open its September and November rows.
  const rowKey = core ? `${core.topicId}@${wk}` : "";
  const isOpen = core ? expanded.has(rowKey) : false;
  const showWholeTopic = core ? expanded.has(`${rowKey}@all`) : false;
  // This week's share of the topic, as the year plan divided it. Bands
  // stored before `pointsByWeek` existed fall back to the whole topic.
  const weekPoints = core?.pointsByWeek?.[wk] ?? (core?.fixedPoints ? [] : undefined);
  const byId = new Map((tp?.points ?? []).map((p) => [p.id, p]));
  const shown =
    showWholeTopic || !weekPoints
      ? (tp?.points ?? [])
      : weekPoints.map((r) => byId.get(r.specPointId)).filter((p) => p !== undefined);
  const hasDetail = (tp?.points.length ?? 0) > 0;
  const isCovered = core ? covered.has(core.topicId) : false;
  // Flag a reschedule only at the topic's new start week, so the badge
  // shows once per moved topic rather than on every week it spans.
  const proposed = proposedSpine?.find((b) => inBand(b, wk));
  // While reviewing, the badge belongs to the proposal — it is the column
  // making the claim. Otherwise it sits on the accepted plan as before.
  const change = proposedSpine
    ? proposed && wk === proposed.startWeek
      ? changeByTopic.get(proposed.topicId)
      : undefined
    : core && wk === core.startWeek
      ? changeByTopic.get(core.topicId)
      : undefined;
  // A week where the proposal puts a different topic than today's plan —
  // the actual shift, worth calling out on the row.
  const shifted = !!proposedSpine && (proposed?.topicId ?? null) !== (core?.topicId ?? null);
  return (
    <div>
      <div
        className={`grid ${cols} items-stretch ${
          change || shifted
            ? "bg-amber-500/[0.06] border-l-2 border-l-amber-500"
            : isNow
              ? "bg-primary/[0.04]"
              : isPast
                ? "bg-muted/20"
                : ""
        }`}
      >
        {/* Week */}
        <div className="px-3 py-2.5 flex flex-col justify-center">
          {isNow && (
            <span className="inline-flex w-fit items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-primary mb-0.5">
              <CircleDot className="w-3 h-3" /> This week
            </span>
          )}
          <span
            className={`text-[13px] font-medium tabular-nums ${
              isPast ? "text-muted-foreground" : ""
            }`}
          >
            {fmtDate(weekKeyToDate(wk))}
          </span>
          {/* Only the claim the engine can support. A week with nothing
              owed says nothing: "Covered" would also be printed over
              work that was merely pulled into a later week, and the
              engine cannot tell those apart. */}
          {isPast && core && owed.length > 0 && (
            <span className="mt-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              {owed.length} not covered
            </span>
          )}
        </div>

        {/* Core */}
        <div className="px-3 py-2.5 border-l border-border min-w-0">
          {core ? (
            <button
              type="button"
              onClick={() => hasDetail && onToggle(rowKey)}
              className={`w-full text-left rounded-md -mx-1 px-1 ${
                hasDetail ? "hover:bg-muted/50" : "cursor-default"
              }`}
              aria-expanded={isOpen}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-medium leading-snug">{core.title}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {isCovered && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  )}
                  {hasDetail && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  )}
                </div>
              </div>
              {change && !proposedSpine && <PacingChangeBadge change={change} />}
            </button>
          ) : (
            <span className="text-[12px] text-muted-foreground/60">—</span>
          )}
          <CatchUpWeek schedule={catchUpSchedule} weekStart={wk} />
        </div>

        {/* Focused */}
        <div className="px-3 py-2.5 border-l border-border min-w-0 space-y-1.5">
          {focused.length > 0 ? (
            focused.map((b) => {
              const k = focusRowKey(b, wk);
              return (
                <FocusTopicButton
                  key={k}
                  band={b}
                  mastery={masteryByTopic.get(b.topicId) ?? 0}
                  hasDetail={focusHasDetail(b, progressByTopic.get(b.topicId))}
                  open={expanded.has(k)}
                  onToggle={() => onToggle(k)}
                />
              );
            })
          ) : (
            <span className="text-[12px] text-muted-foreground/60">—</span>
          )}
        </div>

        {/* Proposed — the re-flowed plan, shown only until it is accepted */}
        {proposedSpine && (
          <div
            className={`px-3 py-2.5 border-l-2 border-l-amber-500 min-w-0 ${
              shifted ? "bg-amber-500/[0.08]" : "bg-amber-500/[0.02]"
            }`}
          >
            {proposed ? (
              <>
                <div className="flex items-start gap-2">
                  <span
                    className={`text-[13px] leading-snug ${
                      shifted
                        ? "font-semibold text-amber-800 dark:text-amber-200"
                        : "font-medium text-muted-foreground"
                    }`}
                  >
                    {proposed.title}
                  </span>
                  {!shifted && !change && (
                    <span className="ml-auto text-[10px] text-muted-foreground/70 shrink-0">
                      same this week
                    </span>
                  )}
                </div>
                {change && <PacingChangeBadge change={change} />}
              </>
            ) : (
              <span className="text-[12px] text-muted-foreground/60">—</span>
            )}
          </div>
        )}
      </div>

      {/* Expanded spec-point breakdown — this week's share of the topic,
          not the whole thing. A six-week topic listing all 17 of its
          points under every one of its weeks answered "what is in this
          topic", when the question being asked is "what am I studying". */}
      {isOpen && tp && (
        <div className="bg-muted/20 px-4 py-2.5 border-t border-border">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {showWholeTopic || !weekPoints
                ? `Whole topic · ${tp.points.length} spec ${tp.points.length === 1 ? "point" : "points"}`
                : `This week · ${shown.length} of ${tp.points.length} spec points`}
            </span>
            {weekPoints && weekPoints.length < tp.points.length && (
              <button
                type="button"
                onClick={() => onToggle(`${rowKey}@all`)}
                className="text-[10px] font-semibold text-primary hover:underline shrink-0"
              >
                {showWholeTopic ? "Show this week only" : "Show whole topic"}
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {shown.map((p) => (
              <PointRow key={p.id} point={p} />
            ))}
          </ul>
        </div>
      )}

      {/* …and the same for any focused topic opened on this row. */}
      {focused.map((b) => {
        const k = focusRowKey(b, wk);
        if (!expanded.has(k)) return null;
        return (
          <FocusPointsPanel
            key={k}
            band={b}
            progress={progressByTopic.get(b.topicId)}
            wholeTopic={expanded.has(`${k}@all`)}
            onToggleWholeTopic={() => onToggle(`${k}@all`)}
          />
        );
      })}
    </div>
  );
}
