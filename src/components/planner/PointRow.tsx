import { ClipboardList, ListChecks } from "lucide-react";
import { type ProgressPoint } from "@/lib/scheduleDal";
import { type PointStatus } from "@/lib/planner/scheduler";
import { describeAssessability } from "@/lib/planner/assessability";

/**
 * One spec point as every expanded topic on the plan shows it.
 *
 * Shared because the row is the *answer to the same question* wherever it
 * appears — "what is this point, and where do I stand on it" — and the two plan
 * tables plus the focus lane had each grown their own copy of it. A student
 * comparing a core topic with a focused one must not be reading two different
 * vocabularies for the same standing.
 */

const statusMeta: Record<PointStatus, { label: string; cls: string }> = {
  new: { label: "Not started", cls: "bg-muted text-muted-foreground border-border" },
  due: {
    label: "Due again",
    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  learning: {
    label: "Learning",
    cls: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
  },
  strong: {
    label: "Strong",
    cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
};

/**
 * One spec point inside an expanded topic: its assessed marks and memory standing.
 *
 * A point with nothing written to test it reports that, rather than borrowing
 * the "Not started" chip. The two look the same from here — no card, no mark —
 * and mean opposite things: one is work the student has not done, the other is
 * work that does not exist. Saying "Not started" for the second blames them for
 * a gap in the library, which on this course is the overwhelmingly common case.
 * See [[assessability]].
 */
export function PointRow({ point }: { point: ProgressPoint }) {
  const unassessable = point.assessability === "unassessable";
  const s = unassessable
    ? {
        label: "No practice yet",
        cls: "bg-muted text-muted-foreground border-border opacity-70",
      }
    : statusMeta[point.status];
  return (
    <li className="flex items-center gap-2 py-1">
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">{point.code}</span>
        <span className="text-[13px]">{point.title}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {point.homeworkScore != null && <MarkChip kind="homework" score={point.homeworkScore} />}
        {point.quizScore != null && <MarkChip kind="quiz" score={point.quizScore} />}
        <span
          className={`inline-flex items-center h-5 px-1.5 rounded-md border text-[10px] font-semibold ${s.cls}`}
          title={describeAssessability(point.assessability)}
        >
          {s.label}
        </span>
      </div>
    </li>
  );
}

/**
 * A spec point the programme knows only by name — it rides in a band, but no
 * progress row came back for it, so there is no standing to report yet.
 */
export function BarePointRow({ code, title }: { code: string; title: string }) {
  return (
    <li className="flex items-center gap-2 py-1">
      <span className="text-[11px] font-semibold text-muted-foreground">{code}</span>
      <span className="text-[13px] flex-1 min-w-0">{title}</span>
    </li>
  );
}

function MarkChip({ kind, score }: { kind: "homework" | "quiz"; score: number }) {
  const strong = score >= 70;
  return (
    <span
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-[10px] font-medium ${
        strong
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
          : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
      }`}
      title={`${kind === "homework" ? "Homework" : "Quiz"}: best ${score}%`}
    >
      {kind === "homework" ? (
        <ClipboardList className="w-2.5 h-2.5" />
      ) : (
        <ListChecks className="w-2.5 h-2.5" />
      )}
      <span className="tabular-nums font-semibold">{score}%</span>
    </span>
  );
}
