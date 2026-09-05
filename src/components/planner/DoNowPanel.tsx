import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, ListChecks, PlayCircle, ClipboardList, Circle } from "lucide-react";
import { type PlanPoint } from "@/lib/weeklyPlanDal";
import {
  type PointActivity,
  type PointWork,
  type PointWorkItem,
  workItems,
} from "@/lib/planner/coverage";
import { type Activity } from "./useWeekPlan";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { VideoModal } from "@/components/VideoPlayer";
import { SignedFileLink } from "@/components/SignedFileLink";
import { SectionHeading, Meter } from "@/components/Shared";
import { SUBJECT_TINT } from "@/lib/subjectTheme";

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
 * student can actually open — the videos to learn it, the homework to practise
 * it, the quiz to check it. No mastery bars, no lanes, no reasoning. Everything
 * here is a thing to press.
 *
 * The tick is the student's own mark and nothing else sets it. Coverage knows
 * when homework was handed in and when a quiz was scored, but a week is mostly
 * work that leaves no trace — watching the video, reading the spec point, doing
 * the questions on paper — and a box that only half-fills itself is worse than
 * one the student owns outright.
 */
export function DoNowPanel({
  points,
  activity,
  subject,
  editable,
  onToggle,
}: {
  points: PlanPoint[];
  activity: Activity;
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

      <ul className="space-y-1.5">
        {points.map((p) => (
          <ChecklistRow
            key={p.spec_point_id}
            point={p}
            work={activity.get(p.spec_point_id)}
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
  editable,
  onToggle,
  onPlay,
}: {
  point: PlanPoint;
  work: (PointActivity & PointWork) | undefined;
  editable: boolean;
  onToggle: (specPointId: string, done: boolean) => void;
  onPlay: (item: PointWorkItem) => void;
}) {
  const done = !!point.done_at;
  const nothingAttached = workItems(work).length === 0;

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-border bg-card/60 px-2.5 py-2">
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

      <div className={`flex-1 min-w-0 ${done ? "opacity-50" : ""}`}>
        <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">{point.code}</span>
        <span className={`text-sm ${done ? "line-through" : ""}`}>{point.title}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        {work?.videos.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onPlay(v)}
            title={v.title}
            className="chip inline-flex text-[11px] hover:brightness-95"
          >
            <PlayCircle className="w-3 h-3" /> Watch
          </button>
        ))}

        {work?.downloads.map((d) =>
          d.filePath ? (
            <SignedFileLink
              key={d.id}
              file={{ path: d.filePath, name: d.fileName ?? d.title }}
              className="chip inline-flex text-[11px] hover:brightness-95"
            />
          ) : null,
        )}

        {/* Homework has no page of its own yet, so every homework chip lands on
            the list. Named, at least, so the student knows what to look for. */}
        {work?.homework.map((h) => (
          <Link
            key={h.id}
            to="/homework"
            title={h.title}
            className="chip inline-flex text-[11px] hover:brightness-95"
          >
            <ClipboardList className="w-3 h-3" /> Homework
          </Link>
        ))}

        {work?.quizzes.map((q) => (
          <Link
            key={q.id}
            to="/mcq/$setId"
            params={{ setId: q.id }}
            title={q.title}
            className="chip inline-flex text-[11px] hover:brightness-95"
          >
            <ListChecks className="w-3 h-3" /> Quiz
          </Link>
        ))}

        {nothingAttached && (
          <span className="text-[11px] text-muted-foreground/60">Read the spec point</span>
        )}
      </div>
    </li>
  );
}
