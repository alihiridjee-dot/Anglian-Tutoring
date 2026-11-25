import { ClipboardList, ListChecks } from "lucide-react";
import { type ProgressPoint } from "@/lib/planner/scheduleDal";
import { type PointStatus } from "@/lib/planner/scheduler";
import { describeAssessability } from "@/lib/planner/assessability";
import { Chip } from "@/components/Shared";
import { DotWord, Mark } from "./workbench/figures";

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

/** The colour of each standing's dot on the plan's bare row. */
const STANDING_TINT: Record<PointStatus, string> = {
  new: "tint-slate",
  due: "tint-amber",
  learning: "tint-primary",
  strong: "tint-emerald",
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
export function PointRow({
  point,
  card = false,
  missed = false,
}: {
  point: ProgressPoint;
  card?: boolean;
  /** Owed from a week that has passed: said in place of its standing. */
  missed?: boolean;
}) {
  const unassessable = point.assessability === "unassessable";
  const s = unassessable
    ? {
        label: "No practice yet",
        cls: "bg-muted text-muted-foreground border-border opacity-70",
      }
    : statusMeta[point.status];
  // The plan's row is bare: the code and title, then where the point stands as
  // a dot and a word, and each mark inside its ring. No card, no pills, and
  // nothing folded away to be opened.
  if (card)
    return (
      <li>
        <BareTitle code={point.code} title={point.title} />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {missed ? (
            <DotWord tint="tint-amber">To catch up</DotWord>
          ) : (
            <DotWord tint={unassessable ? "tint-slate" : STANDING_TINT[point.status]}>
              {unassessable ? "Practice not attached" : s.label}
            </DotWord>
          )}
          {point.assessability === "awaiting" && <DotWord tint="tint-amber">Practice set</DotWord>}
          {point.homeworkScore != null && (
            <span className="inline-flex items-center gap-1.5">
              Task <Mark value={point.homeworkScore} />
            </span>
          )}
          {point.quizScore != null && (
            <span className="inline-flex items-center gap-1.5">
              Quiz <Mark value={point.quizScore} />
            </span>
          )}
        </div>
      </li>
    );
  return (
    // Wraps: on a phone the marks and standing drop under the title rather than
    // squeezing it to a word per line.
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
      <div className="flex-1 min-w-[9rem]">
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
export function BarePointRow({
  code,
  title,
  card = false,
}: {
  code: string;
  title: string;
  card?: boolean;
}) {
  if (card)
    return (
      <li>
        <BareTitle code={code} title={title} />
        <div className="mt-1.5 text-sm">
          <DotWord tint="tint-slate">No results yet</DotWord>
        </div>
      </li>
    );
  return (
    <li className="flex items-center gap-2 py-1">
      <span className="text-[11px] font-semibold text-muted-foreground">{code}</span>
      <span className="text-[13px] flex-1 min-w-0">{title}</span>
    </li>
  );
}

/** A point's code, subdued, and its title in bold, as one line that wraps. */
function BareTitle({ code, title }: { code: string; title: string }) {
  return (
    <p className="text-sm leading-snug">
      <span className="mr-1.5 text-xs font-bold text-muted-foreground">{code}</span>
      <span className="font-bold">{title}</span>
    </p>
  );
}

function MarkChip({ kind, score }: { kind: "homework" | "quiz"; score: number }) {
  const strong = score >= 70;
  return (
    <span title={`${kind === "homework" ? "Task" : "Quiz"}: best ${score}%`}>
      <Chip
        icon={kind === "homework" ? ClipboardList : ListChecks}
        tint={strong ? "tint-emerald" : "tint-amber"}
        className="text-[11px]"
      >
        <span className="tabular-nums">{score}%</span>
      </Chip>
    </span>
  );
}
