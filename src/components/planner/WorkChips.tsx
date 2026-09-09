import { Link } from "@tanstack/react-router";
import { CheckCircle2, ClipboardList, ListChecks, PlayCircle } from "lucide-react";
import {
  type PointCoverage,
  type PointWork,
  type PointWorkItem,
  workItems,
} from "@/lib/planner/coverage";

/**
 * Everything a student can actually open on one spec point, as chips.
 *
 * Shared because "what can I press on this point" has exactly one answer, and
 * the week had been giving two. "What to do now" read the attached work itself
 * and offered the video; "This week" read only the `hasHomework`/`hasQuiz`
 * booleans and, finding neither, wrote the point off as *practice not attached
 * yet* — on the same point, in the same week, with a video sitting behind it.
 *
 * The two panels now lay the same work out differently — "This week" runs it
 * inline after the spec point, "What to do now" sorts it into Watch / MCQs /
 * Homework columns — so what is shared is the *chip*, not the row. Each kind is
 * defined once here, with its icon, its route and the wording of its tooltip,
 * and the panels compose them. `label` is the only thing a layout gets to
 * change: under a column already headed "Homework" the word is redundant, and
 * the space is better spent on a verb.
 */
const CHIP = "chip inline-flex text-[11px] hover:brightness-95";

export function VideoChip({
  item,
  label = "Watch",
  onPlay,
}: {
  item: PointWorkItem;
  label?: string;
  onPlay: (item: PointWorkItem) => void;
}) {
  return (
    <button type="button" onClick={() => onPlay(item)} title={item.title} className={CHIP}>
      <PlayCircle className="w-3 h-3" /> {label}
    </button>
  );
}

/**
 * Straight to the sheet. This used to land every chip on the homework list and
 * name the sheet in a tooltip, which asked a student who had pressed "the
 * homework on osmosis" to go and find the homework on osmosis.
 */
export function HomeworkChip({
  item,
  label = "Homework",
  coverage,
}: {
  item: PointWorkItem;
  label?: string;
  coverage?: PointCoverage | null;
}) {
  const done = !!coverage?.homeworkDone;
  return (
    <Link
      to="/homework/$homeworkId"
      params={{ homeworkId: item.id }}
      title={chipTitle(item, "Homework", done, coverage?.homeworkScore)}
      className={`${CHIP} ${done ? "tint-emerald" : ""}`}
    >
      {done ? <CheckCircle2 className="w-3 h-3" /> : <ClipboardList className="w-3 h-3" />}
      {done && coverage?.homeworkScore != null ? (
        <span className="tabular-nums font-semibold">{coverage.homeworkScore}%</span>
      ) : (
        label
      )}
    </Link>
  );
}

export function QuizChip({
  item,
  label = "Quiz",
  coverage,
}: {
  item: PointWorkItem;
  label?: string;
  coverage?: PointCoverage | null;
}) {
  const done = !!coverage?.quizDone;
  return (
    <Link
      to="/mcq/$setId"
      params={{ setId: item.id }}
      title={chipTitle(item, "Quiz", done, coverage?.quizScore)}
      className={`${CHIP} ${done ? "tint-emerald" : ""}`}
    >
      {done ? <CheckCircle2 className="w-3 h-3" /> : <ListChecks className="w-3 h-3" />}
      {done && coverage?.quizScore != null ? (
        <span className="tabular-nums font-semibold">{coverage.quizScore}%</span>
      ) : (
        label
      )}
    </Link>
  );
}

/** Every chip on a point, inline and in the order a student should meet them. */
export function WorkChips({
  work,
  coverage,
  onPlay,
}: {
  work: PointWork | undefined;
  /**
   * How the point was practised, when the surface is reporting on the week.
   * Omitted while the week is still being worked — a mark is a verdict, and
   * there is nothing to judge yet.
   */
  coverage?: PointCoverage | null;
  onPlay: (item: PointWorkItem) => void;
}) {
  const nothingAttached = workItems(work).length === 0;

  return (
    <>
      {work?.videos.map((v) => (
        <VideoChip key={v.id} item={v} onPlay={onPlay} />
      ))}
      {work?.homework.map((h) => (
        <HomeworkChip key={h.id} item={h} coverage={coverage} />
      ))}
      {work?.quizzes.map((q) => (
        <QuizChip key={q.id} item={q} coverage={coverage} />
      ))}

      {nothingAttached && (
        <span className="text-[11px] text-muted-foreground/60">Read the spec point</span>
      )}
    </>
  );
}

/**
 * A chip's tooltip.
 *
 * Coverage is recorded against the *point*, not the individual homework or
 * quiz, so a point carrying two quizzes shows the same mark on both. The
 * wording says so rather than crediting the student with a particular one they
 * may not have opened.
 */
function chipTitle(
  item: PointWorkItem,
  kind: string,
  done: boolean | undefined,
  score: number | null | undefined,
): string {
  if (!done) return item.title;
  const mark = score != null ? `, best ${score}%` : "";
  return `${item.title} — ${kind.toLowerCase()} logged on this point${mark}`;
}
