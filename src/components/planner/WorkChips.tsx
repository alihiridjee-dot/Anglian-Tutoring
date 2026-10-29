import { Link } from "@tanstack/react-router";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  PlayCircle,
  Sparkle,
  type LucideIcon,
} from "lucide-react";
import {
  type PointCoverage,
  type PointWork,
  type PointWorkItem,
  workItems,
} from "@/lib/planner/coverage";
import type { SpecPointNote } from "@/hooks/data/useNotes";

/**
 * Everything a student can actually open on one spec point, as chips.
 *
 * Shared because "what can I press on this point" has exactly one answer, and
 * the week had been giving two. "Weekly task list" read the attached work itself
 * and offered the video; "This week" read only the `hasHomework`/`hasQuiz`
 * booleans and, finding neither, wrote the point off as *practice not attached
 * yet* — on the same point, in the same week, with a video sitting behind it.
 *
 * The two panels now lay the same work out differently — "This week" runs it
 * inline after the spec point, "Weekly task list" sorts it into Watch / MCQs /
 * Homework columns — so what is shared is the *chip*, not the row. Each kind is
 * defined once here, with its icon, its route and the wording of its tooltip,
 * and the panels compose them. `label` is the only thing a layout gets to
 * change: under a column already headed "Homework" the word is redundant, and
 * the space is better spent on a verb.
 *
 * On a phone the weekly task list draws the same work as a step trail instead
 * (see `DoNowPanel`), so each kind has a step here too. A step opens what its
 * chip opens — the route and the tooltip below are shared — so the two layouts
 * differ in shape only.
 */
const CHIP =
  "chip tap-target inline-flex whitespace-nowrap shrink-0 text-[11px] hover:brightness-95";

// Where each kind opens, for the chip and the step alike. The showcase renders
// both from fixtures under /demo/student; the guarded route would bounce a
// visitor to sign-in.
const noteLink = (note: SpecPointNote) =>
  ({
    to: isDemoStudent() ? "/demo/student/notes/$conceptId" : "/notes/$conceptId",
    params: { conceptId: note.id },
  }) as const;

const homeworkLink = (item: PointWorkItem) =>
  ({
    to: isDemoStudent() ? "/demo/student/homework/$homeworkId" : "/homework/$homeworkId",
    params: { homeworkId: item.id },
  }) as const;

const quizLink = (item: PointWorkItem) =>
  ({
    to: isDemoStudent() ? "/demo/student/mcq/$setId" : "/mcq/$setId",
    params: { setId: item.id },
  }) as const;

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

/** Straight to the point's revision note. */
export function NoteChip({ note, label = "Notes" }: { note: SpecPointNote; label?: string }) {
  return (
    <Link {...noteLink(note)} title={note.title} className={CHIP}>
      <BookOpen className="w-3 h-3" /> {label}
    </Link>
  );
}

/**
 * Straight to the sheet. This used to land every chip on the homework list and
 * name the sheet in a tooltip, which asked a student who had pressed "the
 * homework on osmosis" to go and find the homework on osmosis.
 */
export function HomeworkChip({
  item,
  label = "Task",
  coverage,
}: {
  item: PointWorkItem;
  label?: string;
  coverage?: PointCoverage | null;
}) {
  const done = !!coverage?.homeworkDone;
  return (
    <Link
      {...homeworkLink(item)}
      title={chipTitle(item, "Task", done, coverage?.homeworkScore)}
      className={`${CHIP} ${done ? "tint-emerald chip-done" : ""}`}
    >
      {done ? <CheckCircle2 className="w-3 h-3" /> : <ClipboardList className="w-3 h-3" />}
      {done && coverage?.homeworkScore != null ? (
        <span className="tabular-nums font-semibold">{coverage.homeworkScore}%</span>
      ) : done ? (
        // Handed in but not marked yet: the tick alone says it. The layout's
        // verb ("Start") would ask the student to do it again.
        <>
          <Sparkle className="chip-sparkle" fill="currentColor" aria-hidden />
          <span className="sr-only">Handed in</span>
          {/* Keeps the text line so the pill is as tall as its neighbours. */}
          <span aria-hidden>{"\u200b"}</span>
        </>
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
      {...quizLink(item)}
      title={chipTitle(item, "Quiz", done, coverage?.quizScore)}
      className={`${CHIP} ${done ? "tint-emerald chip-done" : ""}`}
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
 * One step's face: the dot and the word under it. The word is what the step
 * says on screen; `kind` is read out first when the word alone ("13%") would
 * not say what it is a mark for.
 */
function StepFace({
  icon: Icon,
  word,
  kind,
  done = false,
}: {
  icon: LucideIcon;
  word: string;
  kind?: string;
  done?: boolean;
}) {
  return (
    <>
      <span className={`icon-tile trail-dot ${done ? "icon-tile-solid" : ""}`}>
        <Icon className="size-4.5" aria-hidden />
      </span>
      <span className="trail-label">
        {kind ? <span className="sr-only">{`${kind} `}</span> : null}
        {word}
      </span>
    </>
  );
}

export function VideoStep({
  item,
  onPlay,
}: {
  item: PointWorkItem;
  onPlay: (item: PointWorkItem) => void;
}) {
  return (
    <button type="button" onClick={() => onPlay(item)} title={item.title} className="trail-step">
      <StepFace icon={PlayCircle} word="Play" />
    </button>
  );
}

export function NoteStep({ note }: { note: SpecPointNote }) {
  return (
    <Link {...noteLink(note)} title={note.title} className="trail-step">
      <StepFace icon={BookOpen} word="Read" />
    </Link>
  );
}

export function HomeworkStep({
  item,
  coverage,
}: {
  item: PointWorkItem;
  coverage?: PointCoverage | null;
}) {
  const done = !!coverage?.homeworkDone;
  const score = coverage?.homeworkScore;
  return (
    <Link
      {...homeworkLink(item)}
      title={chipTitle(item, "Task", done, score)}
      className={`trail-step ${done ? "tint-emerald" : ""}`}
    >
      {done ? (
        // Handed in but not marked yet still reads as done: "Task" would ask
        // the student to do it again.
        <StepFace icon={Check} word={score != null ? `${score}%` : "Handed in"} kind="Task" done />
      ) : (
        <StepFace icon={ClipboardList} word="Task" />
      )}
    </Link>
  );
}

export function QuizStep({
  item,
  coverage,
}: {
  item: PointWorkItem;
  coverage?: PointCoverage | null;
}) {
  const done = !!coverage?.quizDone;
  const score = coverage?.quizScore;
  return (
    <Link
      {...quizLink(item)}
      title={chipTitle(item, "Quiz", done, score)}
      className={`trail-step ${done ? "tint-emerald" : ""}`}
    >
      {done ? (
        <StepFace icon={Check} word={score != null ? `${score}%` : "Done"} kind="Quiz" done />
      ) : (
        <StepFace icon={ListChecks} word="Quiz" />
      )}
    </Link>
  );
}

const STEP_KIND = {
  video: { icon: PlayCircle, word: "Play" },
  note: { icon: BookOpen, word: "Read" },
  quiz: { icon: ListChecks, word: "Quiz" },
  task: { icon: ClipboardList, word: "Task" },
} satisfies Record<string, { icon: LucideIcon; word: string }>;

/**
 * A step with nothing behind it: the library has no video, note, quiz or task
 * on this point yet. Drawn in its place so the trail keeps its order, and
 * pressable by nobody.
 */
export function EmptyStep({ kind, empty }: { kind: keyof typeof STEP_KIND; empty: string }) {
  const { icon: Icon, word } = STEP_KIND[kind];
  return (
    <span className="trail-step" title={empty}>
      <span className="icon-tile trail-dot trail-dot-empty">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <span className="trail-label trail-label-empty" aria-hidden>
        {word}
      </span>
      <span className="sr-only">{empty}</span>
    </span>
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
