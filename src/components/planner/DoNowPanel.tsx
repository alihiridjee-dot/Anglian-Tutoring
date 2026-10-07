import { type ReactNode, useState } from "react";
import { CheckCircle2, ListChecks, Circle } from "lucide-react";
import { type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import {
  type PointActivity,
  type PointCoverage,
  type PointWork,
  type PointWorkItem,
  practiceComplete,
} from "@/lib/planner/coverage";
import { type Activity } from "./useWeekPlan";
import { parseVideoUrl } from "@/lib/curriculum/videoEmbed";
import { VideoModal } from "@/components/VideoPlayer";
import { SectionHeading, Meter } from "@/components/Shared";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { HomeworkChip, NoteChip, QuizChip, VideoChip } from "./WorkChips";
import { useSpecPointNotes, type SpecPointNote } from "@/hooks/data/useNotes";

/**
 * "Weekly task list" — the week as a single checklist.
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
 * sorted into fixed columns: **Watch**, **Read**, **MCQs**, **Homework**. That only
 * works because each is attached per spec point: one video, one note, one quiz and
 * one homework each, so a row has at most one thing in each cell and the columns
 * line up down the page. A grouped homework spanning four points would have to
 * repeat itself in four rows, which is the layout this replaced.
 *
 * The columns are also the answer to "what have I actually covered": a cell is
 * either something to press, a mark, or an honest dash. Nothing is implied.
 *
 * The tick is earned, not claimed. On a point with a quiz or a task the box is
 * locked: the database ticks it (20261007094747) once every task and quiz is in
 * ({@link practiceComplete}), and the row is crossed off for good, because
 * handed-in work can't be un-done. Only a point with no practice attached yet
 * keeps a box the student ticks themselves. Coverage also fills the cells: a
 * task handed in shows a tick, and its mark once it is back, instead of asking
 * the student to start it again.
 */

/** The row's shape: the spec point takes the slack, the four cells are fixed. */
const GRID = "sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,5.25rem))] sm:gap-x-3";

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
  const { data: notes } = useSpecPointNotes(points.map((p) => p.spec_point_id));

  const workDone = (p: PlanPoint) =>
    practiceComplete(activity.get(p.spec_point_id), coverage?.get(p.spec_point_id));
  const isDone = (p: PlanPoint) => !!p.done_at || workDone(p);

  const doneCount = points.filter(isDone).length;
  const total = points.length;
  const allDone = total > 0 && doneCount === total;

  // The first unticked point — the one thing the header points at, so a student
  // who opens the dashboard with no plan of their own still has somewhere to go.
  const next = points.find((p) => !isDone(p)) ?? null;

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
            title="Weekly task list"
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
        <span>Read</span>
        <span>MCQs</span>
        <span>Tasks</span>
      </div>

      <ul className="space-y-1.5">
        {points.map((p) => (
          <ChecklistRow
            key={p.spec_point_id}
            point={p}
            work={activity.get(p.spec_point_id)}
            coverage={coverage?.get(p.spec_point_id)}
            note={notes?.get(p.spec_point_id)?.[0]}
            workDone={workDone(p)}
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
  note,
  workDone,
  editable,
  onToggle,
  onPlay,
}: {
  point: PlanPoint;
  work: (PointActivity & PointWork) | undefined;
  coverage: PointCoverage | undefined;
  /** The note written for this point; one per row, so the column lines up. */
  note: SpecPointNote | undefined;
  /** Every task and quiz on the point is in, so the row is done whatever the box says. */
  workDone: boolean;
  editable: boolean;
  onToggle: (specPointId: string, done: boolean) => void;
  onPlay: (item: PointWorkItem) => void;
}) {
  const done = !!point.done_at || workDone;
  // What the database waits for before it ticks this point. Empty means no
  // practice is attached yet, and the box is still the student's own.
  const earnedBy = [
    work?.quizzes.length ? "the quiz" : null,
    work?.homework.length ? "the task" : null,
  ].filter(Boolean);
  // Earned, never claimed: and handed-in work can't be un-done, so neither can its tick.
  const locked = !editable || workDone || earnedBy.length > 0;

  return (
    <li
      className={`${GRID} sm:items-center premium-card planner-point-row px-2.5 py-2 transition-opacity ${
        done ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={
            workDone
              ? `${point.code} ${point.title}: done, every task and quiz is in`
              : earnedBy.length > 0
                ? `${point.code} ${point.title}: ticks itself once you attempt ${earnedBy.join(" and ")}`
                : `${done ? "Untick" : "Tick off"} ${point.code} ${point.title}`
          }
          title={
            earnedBy.length > 0 && !done
              ? `Ticks itself once you attempt ${earnedBy.join(" and ")}`
              : undefined
          }
          disabled={locked}
          onClick={() => onToggle(point.spec_point_id, !done)}
          className={`tap-target shrink-0 transition ${
            done
              ? "text-[color:var(--tint)]"
              : locked
                ? "text-muted-foreground/40"
                : "text-muted-foreground/40 hover:text-[color:var(--tint)]"
          } ${locked ? "cursor-default" : ""}`}
        >
          {done ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
        </button>

        <div className={`min-w-0 ${done ? "line-through" : ""}`}>
          <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">
            {point.code}
          </span>
          <span className="text-sm">{point.title}</span>
        </div>
      </div>

      <WorkCell label="Watch" empty="No video on this point yet">
        {work?.videos.map((v) => (
          <VideoChip key={v.id} item={v} label="Play" onPlay={onPlay} />
        ))}
      </WorkCell>

      <WorkCell label="Read" empty="No revision note on this point yet">
        {note ? [<NoteChip key={note.id} note={note} label="Read" />] : []}
      </WorkCell>

      <WorkCell label="MCQs" empty="No quiz on this point yet">
        {work?.quizzes.map((q) => (
          <QuizChip key={q.id} item={q} label="Start" coverage={coverage} />
        ))}
      </WorkCell>

      <WorkCell label="Tasks" empty="No tasks set on this point yet">
        {work?.homework.map((h) => (
          <HomeworkChip key={h.id} item={h} label="Start" coverage={coverage} />
        ))}
      </WorkCell>
    </li>
  );
}

/**
 * One cell of the four.
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
