import { type ReactNode, useMemo, useState } from "react";
import { CheckCircle2, ListChecks, Circle } from "lucide-react";
import { type PlanPoint } from "@/lib/weeklyPlanDal";
import {
  type PointActivity,
  type PointCoverage,
  type PointWork,
  type PointWorkItem,
} from "@/lib/planner/coverage";
import { type Activity } from "./useWeekPlan";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { VideoModal } from "@/components/VideoPlayer";
import { SectionHeading, Meter } from "@/components/Shared";
import { SUBJECT_TINT } from "@/lib/subjectTheme";
import { HomeworkChip, QuizChip, VideoChip } from "./WorkChips";

/**
 * "What to do now" — the week as a single checklist.
 *
 * The panel above this one explains the week: which topic is on schedule, what
 * came back round, how well it's all sticking. That is the right answer to *why
 * am I doing this*, and the wrong answer to *what do I do now* — it splits ten
 * spec points across three boxes, orders none of them, and leaves the student to
 * work out for themselves how "4.1.1 Cell structure" turns into an activity.
 *
 * So this is deliberately the dumbest surface on the dashboard: one flat list in
 * curriculum order, one tick box per spec point, and beside each the things the
 * student can actually open. No mastery bars, no lanes, no reasoning. Everything
 * here is a thing to press.
 *
 * Where it used to run that work together as one undifferentiated row of chips —
 * which made it read as a second copy of the core-topic card — the work is now
 * sorted into three fixed columns: **Watch**, **MCQs**, **Homework**. That only
 * works because all three are attached per spec point: one video, one quiz and
 * one homework each, so a row has at most one thing in each cell and the columns
 * line up down the page. A grouped homework spanning four points would have to
 * repeat itself in four rows, which is the layout this replaced.
 *
 * The columns are also the answer to "what have I actually covered": a cell is
 * either something to press, a mark, or an honest dash. Nothing is implied.
 *
 * The tick is the student's own mark and nothing else sets it. Coverage knows
 * when homework was handed in and when a quiz was scored, but a week is mostly
 * work that leaves no trace — watching the video, reading the spec point, doing
 * the questions on paper — and a box that only half-fills itself is worse than
 * one the student owns outright. Coverage is still read, but only inside a cell:
 * a homework that has come back marked shows its mark instead of asking the
 * student to start work they have already handed in.
 */

/** The row's shape: the spec point takes the slack, the three cells are fixed. */
const GRID = "sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,5.25rem))] sm:gap-x-3";

export function DoNowPanel({
  points,
  activity,
  coverage,
  subject,
  editable,
  onToggle,
}: {
  points: PlanPoint[];
  activity: Activity;
  /** What has already been handed in and marked, so a cell can say so. */
  coverage?: Map<string, PointCoverage>;
  /** The week's subject — tints the whole card to Biology/Chemistry/Physics. */
  subject: string;
  /** Past weeks are read-only — you can look, but you can't tick history. */
  editable: boolean;
  onToggle: (specPointId: string, done: boolean) => void;
}) {
  const [playing, setPlaying] = useState<{ item: PointWorkItem } | null>(null);

  const doneCount = points.filter((p) => p.done_at).length;
  const total = points.length;
  const allDone = total > 0 && doneCount === total;

  // The first unticked point — the one thing the header points at, so a student
  // who opens the dashboard with no plan of their own still has somewhere to go.
  const next = useMemo(() => points.find((p) => !p.done_at) ?? null, [points]);

  if (total === 0) return null;

  const embed = playing ? parseVideoUrl(playing.item.videoUrl) : null;

  return (
    <div className={`rounded-2xl premium-card p-4 sm:p-5 mb-4 ${SUBJECT_TINT[subject] ?? ""}`}>
      <div className="flex items-start gap-2.5">
        <span className="icon-tile inline-flex w-9 h-9 shrink-0">
          <ListChecks className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <SectionHeading
            title="What to do now"
            hint={
              allDone
                ? "Everything ticked off — nice one."
                : next
                  ? `Next up: ${next.code} ${next.title}`
                  : "Work through the list — tick each one off as you go."
            }
          >
            <span className="numeral text-sm text-[color:var(--tint)]">
              {doneCount} of {total} done
            </span>
          </SectionHeading>
        </div>
      </div>

      {/* One bar for the whole week. The mastery bars upstairs say how well it's
          going; this one only says how far through it you are. */}
      <Meter value={total ? (doneCount / total) * 100 : 0} size="sm" className="my-3" />

      {/* Column headings, wide screens only. On a phone the row stacks and each
          cell carries its own label instead. */}
      <div
        aria-hidden
        className={`hidden ${GRID} px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70`}
      >
        <span />
        <span>Watch</span>
        <span>MCQs</span>
        <span>Homework</span>
      </div>

      <ul className="space-y-1.5">
        {points.map((p) => (
          <ChecklistRow
            key={p.spec_point_id}
            point={p}
            work={activity.get(p.spec_point_id)}
            coverage={coverage?.get(p.spec_point_id)}
            editable={editable}
            onToggle={onToggle}
            onPlay={(item) => setPlaying({ item })}
          />
        ))}
      </ul>

      {playing && embed && (
        <VideoModal embed={embed} title={playing.item.title} onClose={() => setPlaying(null)} />
      )}
    </div>
  );
}

function ChecklistRow({
  point,
  work,
  coverage,
  editable,
  onToggle,
  onPlay,
}: {
  point: PlanPoint;
  work: (PointActivity & PointWork) | undefined;
  coverage: PointCoverage | undefined;
  editable: boolean;
  onToggle: (specPointId: string, done: boolean) => void;
  onPlay: (item: PointWorkItem) => void;
}) {
  const done = !!point.done_at;

  return (
    <li
      className={`${GRID} sm:items-center rounded-lg border border-border bg-card/60 px-2.5 py-2`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`${done ? "Untick" : "Tick off"} ${point.code} ${point.title}`}
          disabled={!editable}
          onClick={() => onToggle(point.spec_point_id, !done)}
          className={`shrink-0 transition ${
            done
              ? "text-[color:var(--tint)]"
              : "text-muted-foreground/40 hover:text-[color:var(--tint)]"
          } ${editable ? "" : "cursor-default"}`}
        >
          {done ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
        </button>

        <div className={`min-w-0 ${done ? "opacity-50" : ""}`}>
          <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">
            {point.code}
          </span>
          <span className={`text-sm ${done ? "line-through" : ""}`}>{point.title}</span>
        </div>
      </div>

      <WorkCell label="Watch" empty="No video on this point yet">
        {work?.videos.map((v) => (
          <VideoChip key={v.id} item={v} label="Play" onPlay={onPlay} />
        ))}
      </WorkCell>

      <WorkCell label="MCQs" empty="No quiz on this point yet">
        {work?.quizzes.map((q) => (
          <QuizChip key={q.id} item={q} label="Start" coverage={coverage} />
        ))}
      </WorkCell>

      <WorkCell label="Homework" empty="No homework set on this point yet">
        {work?.homework.map((h) => (
          <HomeworkChip key={h.id} item={h} label="Start" coverage={coverage} />
        ))}
      </WorkCell>
    </li>
  );
}

/**
 * One cell of the three.
 *
 * The empty state is the important half. Most spec points have a video and
 * nothing else, so these cells are blank far more often than they are full, and
 * a blank that reads as *broken* would make the whole panel look broken. A dash
 * says the library has nothing here yet, in the tooltip and to a screen reader,
 * without implying the student has missed anything.
 */
function WorkCell({
  label,
  empty,
  children,
}: {
  label: string;
  empty: string;
  children: ReactNode;
}) {
  // `children` is an array from `.map()` — empty when the point has none of this
  // kind, which is what the dash is for.
  const filled = Array.isArray(children) ? children.length > 0 : !!children;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5 sm:mt-0">
      <span className="sm:hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 w-[4.75rem] shrink-0">
        {label}
      </span>
      {filled ? (
        children
      ) : (
        <span className="text-muted-foreground/40 text-xs" title={empty}>
          —<span className="sr-only">{empty}</span>
        </span>
      )}
    </div>
  );
}
