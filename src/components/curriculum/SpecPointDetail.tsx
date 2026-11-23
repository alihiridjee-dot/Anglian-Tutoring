import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { generateMcqSet, replaceMcqQuestions } from "@/lib/mcq/mcq.functions";
import { toast } from "sonner";
import { CurriculumDAL } from "@/lib/curriculum/curriculumDal";
import { EmptyState, Spinner } from "@/components/Shared";
import type { SpecPoint, Resource, McqSet } from "@/lib/curriculum/types";
import { VideoModal, VideoThumbnail } from "@/components/VideoPlayer";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { parseVideoUrl, type VideoEmbed } from "@/lib/curriculum/videoEmbed";
import { SpecPointVideoEditor, type EditableVideo } from "@/components/tutor/SpecPointVideoEditor";
import { useSpecPointNotes } from "@/hooks/data/useNotes";
import { Chip } from "@/components/Shared";
import { formatWhen, joinClick, showsJoin } from "@/lib/live/liveSessions";
import { useNow } from "@/hooks/useNow";
import { useEntryState } from "@/hooks/useEntryState";
import { plannerDateLabel } from "@/lib/planner/week";
import { retakeOpensAt } from "@/lib/mcq/retakeLock";
import { Plus, Pencil, Trash2, Sparkles, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PracticePanel,
  practiceWaiting,
  practiceWord,
  usePractice,
} from "@/components/curriculum/PracticeRequest";

type StopKey = "watch" | "read" | "quiz" | "task" | "live";
type Stop = {
  key: StopKey;
  label: string;
  emoji: string;
  /** How many things the stop opens onto. */
  items: number;
  /** The words under its name: a count, or where its quiz or task stands. */
  word: string;
  /** Every quiz taken: the stop goes green. */
  done?: boolean;
};

/** The one button a row leads to: Read, Take, Open, Join. */
const GO = "btn-solid inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 py-2 text-sm";

/** A quiz the student has taken: their best score, and when it opens again. */
type TakenSet = { pct: number; opensAt: Date };

/**
 * The student's own attempts at these sets, read the way the MCQs page reads
 * them: the best score, and the week lock from the latest attempt.
 */
async function readMyAttempts(userId: string, setIds: string[]): Promise<Record<string, TakenSet>> {
  const { data, error } = await supabase
    .from("mcq_attempts")
    .select("set_id, score, total, created_at")
    .eq("user_id", userId)
    .in("set_id", setIds);
  // Only the button's word rides on this. The quiz page reads the lock itself,
  // so a failed read still opens a taken quiz as its review.
  if (error) {
    console.error("Error loading the student's attempts:", error);
    return {};
  }
  const out: Record<string, TakenSet> = {};
  for (const a of data ?? []) {
    const pct = a.total > 0 ? Math.round((a.score / a.total) * 100) : 0;
    const opensAt = retakeOpensAt(a.created_at);
    const prev = out[a.set_id];
    out[a.set_id] = {
      pct: prev ? Math.max(prev.pct, pct) : pct,
      opensAt: prev && prev.opensAt > opensAt ? prev.opensAt : opensAt,
    };
  }
  return out;
}

export function SpecPointDetail({
  point,
  isTutor,
  onChanged,
  taxonomy,
}: {
  point: SpecPoint;
  isTutor: boolean;
  onChanged: () => void;
  taxonomy: { subject: SubjectV; board: BoardV; level: LevelV };
}) {
  const { userId } = useRoles();
  const [resources, setResources] = useState<Resource[]>([]);
  const [mcqSets, setMcqSets] = useState<McqSet[]>([]);
  const [taken, setTaken] = useState<Record<string, TakenSet>>({});
  const [genLoading, setGenLoading] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  // `null` inside the object means "creating"; the outer null means closed.
  const [editingVideo, setEditingVideo] = useState<{ video: EditableVideo | null } | null>(null);
  const [activeVideo, setActiveVideo] = useState<{
    embed: VideoEmbed;
    title: string;
    description?: string | null;
  } | null>(null);
  const genFn = useServerFn(generateMcqSet);
  const replaceFn = useServerFn(replaceMcqQuestions);
  const { data: notesByPoint } = useSpecPointNotes([point.id]);
  const notes = notesByPoint?.get(point.id) ?? [];

  const [loadFailed, setLoadFailed] = useState(false);
  // Which point the lists above belong to: the trail waits for its own.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loaded = loadedFor === point.id;
  // The stop the student pressed. Until they press one, the first with work.
  // Kept with the visit, so coming back from a quiz or a task reopens the stop
  // it was opened from (useEntryState).
  const [picked, setPicked] = useEntryState<StopKey | null>("point-stop", null);
  const shownFor = useRef(point.id);
  // Each load is numbered and only the newest may land, so a slow answer for
  // the point that was open before can't fill this one.
  const loadSeq = useRef(0);
  const reload = async () => {
    const seq = ++loadSeq.current;
    try {
      const { resources: resList, mcqSets: mList } =
        await CurriculumDAL.getResourcesAndMcqSets(point);
      // A tutor's preview files nothing, and the showcase has no account.
      const mine =
        isTutor || !userId || isDemoStudent() || mList.length === 0
          ? {}
          : await readMyAttempts(
              userId,
              mList.map((s) => s.id),
            );
      if (seq !== loadSeq.current) return;
      setResources(resList);
      setMcqSets(mList);
      setTaken(mine);
      setLoadFailed(false);
      setLoadedFor(point.id);
    } catch (e) {
      console.error(e);
      if (seq === loadSeq.current) setLoadFailed(true);
    }
  };

  useEffect(() => {
    // Another point starts on its first stop; the same one, opened again by
    // Back, keeps the stop it was left on.
    if (shownFor.current !== point.id) {
      shownFor.current = point.id;
      setPicked(null);
    }
    reload(); /* eslint-disable-next-line */
  }, [point.id, userId]);

  // Never in the showcase: it has no session to ask with.
  const practice = usePractice(point.id, !isTutor && !isDemoStudent(), () => reload());

  const generate = async () => {
    setGenLoading(true);
    try {
      const res = await genFn({ data: { specPointId: point.id } });
      // Queued is a deferral, not a result: the set doesn't exist yet.
      if (res.queued)
        toast.info(
          "Queued — this point's MCQs will be written shortly; reopen the point to see them",
        );
      else
        toast.success(
          res.created
            ? "Generated this point's MCQs — every student now shares them"
            : "This point already has its MCQs — use Replace questions to write new ones",
        );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenLoading(false);
    }
  };

  const publish = async (setId: string, published: boolean) => {
    const { error } = await supabase
      .from("mcq_sets")
      .update({ published: !published })
      .eq("id", setId);
    if (error) return toast.error(error.message);
    reload();
  };

  // A quiz students have taken is refused by the database (S-18): their
  // results would go with it. The refusal says how many, and points here.
  const delSet = async (setId: string) => {
    if (
      !confirm(
        "Delete this MCQ set and its questions? A quiz students have taken can't be deleted.",
      )
    )
      return;
    const { error } = await supabase.from("mcq_sets").delete().eq("id", setId);
    if (error) return toast.error(error.message);
    reload();
  };

  const replaceSet = async (setId: string) => {
    if (
      !confirm(
        "Write a new set of questions for this quiz? The current questions are replaced for every student. Scores from past attempts stay as they are.",
      )
    )
      return;
    setReplacingId(setId);
    try {
      const res = await replaceFn({ data: { setId } });
      toast.success(`Questions replaced — ${res.questions} new questions`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't replace the questions");
    } finally {
      setReplacingId(null);
    }
  };

  const videos = resources.filter((r) => r.kind === "video");
  const tasks = resources.filter((r) => r.kind === "homework");
  const sessions = resources.filter((r) => r.kind === "live_session");
  // What goes under a stop's name: how many things it has, or, with none, where
  // its quiz or task stands. A tutor is told of a gap; a student gets `null`,
  // and a stop with nothing to say isn't drawn.
  const word = (n: number, one: string, waiting: string | null = null, many = `${one}s`) =>
    n > 0 ? `${n} ${n === 1 ? one : many}` : (waiting ?? (isTutor ? "None yet" : null));
  const stops = [
    {
      key: "watch",
      label: "Watch",
      emoji: "🎬",
      items: videos.length,
      word: word(videos.length, "video"),
    },
    {
      key: "read",
      label: "Read",
      emoji: "📖",
      items: notes.length,
      word: word(notes.length, "note"),
    },
    {
      key: "quiz",
      label: "Quiz",
      emoji: "🎯",
      items: mcqSets.length,
      word: word(mcqSets.length, "quiz", practiceWord(practice, "quiz"), "quizzes"),
      done: !isTutor && mcqSets.length > 0 && mcqSets.every((s) => taken[s.id]),
    },
    {
      key: "task",
      label: "Task",
      emoji: "✏️",
      items: tasks.length,
      word: word(tasks.length, "task", practiceWord(practice, "task")),
    },
    // A lesson is a stop only when there is one.
    {
      key: "live",
      label: "Live",
      emoji: "👋",
      items: sessions.length,
      word: sessions.length ? word(sessions.length, "lesson") : null,
    },
  ].filter((s): s is Stop => s.word !== null);
  const active =
    stops.find((s) => s.key === picked)?.key ??
    (stops.find((s) => s.items > 0) ?? stops[0])?.key ??
    null;

  return (
    <div className="space-y-6">
      {isTutor && (
        <div className="rounded-xl bg-secondary/40 border border-border p-4 flex flex-wrap gap-2">
          <button
            onClick={generate}
            disabled={genLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 min-h-11 sm:pointer-fine:min-h-0 rounded-md bg-accent/20 border border-accent/40 text-accent-foreground text-xs font-semibold hover:bg-accent/30 disabled:opacity-60"
          >
            <Sparkles className="w-3.5 h-3.5" /> {genLoading ? "Generating…" : "AI generate MCQs"}
          </button>
          <button
            onClick={() => setEditingVideo({ video: null })}
            className="inline-flex items-center gap-2 px-3 py-1.5 min-h-11 sm:pointer-fine:min-h-0 rounded-md border border-border text-xs text-foreground font-semibold hover:bg-secondary/40 transition"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Add video to this point
          </button>
          <Link
            to="/tutor"
            className="inline-flex items-center gap-2 px-3 py-1.5 min-h-11 sm:pointer-fine:min-h-0 rounded-md border border-border text-xs text-foreground font-semibold hover:bg-secondary/40 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add resource in Tutor Studio
          </Link>
        </div>
      )}

      {loadFailed && (
        <EmptyState
          compact
          title="This point's videos, tasks and quizzes didn't load"
          body="Check your connection and refresh the page."
        />
      )}

      {/* The trail: the point's work as stops, Watch → Read → Quiz → Task, and
          the stop that's picked opens underneath. A stop with nothing behind it
          isn't drawn, unless its quiz or task can be asked for or is on its way. */}
      {!loaded && !loadFailed && <Spinner label="Loading this point" className="py-10" />}
      {loaded && stops.length > 0 && (
        <div data-guide="point-sections">
          <div
            role="tablist"
            aria-label="This point's work"
            className="point-trail"
            style={{ "--stops": stops.length } as React.CSSProperties}
          >
            {stops.length > 1 && <TrailPath gaps={stops.length - 1} />}
            {stops.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                id={`point-stop-${s.key}`}
                aria-selected={s.key === active}
                aria-controls="point-panel"
                onClick={() => setPicked(s.key)}
                className={cn("point-stop", s.done && "tint-emerald")}
                data-state={s.items > 0 ? "open" : "waiting"}
              >
                <span className="point-stop-dot">
                  {s.items > 0 || s.word !== "Being written" ? (
                    <span aria-hidden>{s.done ? "✅" : s.emoji}</span>
                  ) : (
                    <Spinner compact label="Being written" />
                  )}
                </span>
                <span className="point-stop-label">{s.label}</span>
                <span className="point-stop-word">{s.word}</span>
              </button>
            ))}
          </div>

          <div
            key={active}
            id="point-panel"
            role="tabpanel"
            aria-labelledby={`point-stop-${active}`}
            className="point-panel premium-card p-4 sm:p-6"
          >
            {active === "watch" &&
              (videos.length === 0 ? (
                <Empty label="No videos yet" />
              ) : (
                <ul className={cn("grid gap-4", videos.length > 1 ? "sm:grid-cols-2" : "max-w-xl")}>
                  {videos.map((r) => {
                    const embed = parseVideoUrl(r.video_url);
                    return (
                      <li key={r.id} className="relative">
                        <button
                          type="button"
                          disabled={!embed}
                          onClick={() =>
                            embed &&
                            setActiveVideo({ embed, title: r.title, description: r.description })
                          }
                          className="group w-full text-left disabled:cursor-default disabled:opacity-60"
                        >
                          <span className="block overflow-hidden rounded-2xl">
                            <VideoThumbnail embed={embed} />
                          </span>
                          <span className="font-display mt-3 block text-lg leading-snug font-bold">
                            {r.title}
                          </span>
                          {r.description && (
                            <span className="mt-1 block text-sm line-clamp-2">{r.description}</span>
                          )}
                        </button>
                        {isTutor && (
                          <button
                            type="button"
                            onClick={() =>
                              setEditingVideo({
                                video: {
                                  id: r.id,
                                  title: r.title,
                                  description: r.description,
                                  video_url: r.video_url,
                                },
                              })
                            }
                            className="tap-target absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border border-border bg-background/90 px-2 py-1 text-xs font-bold text-foreground shadow-xs transition hover:border-primary/50"
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}

            {active === "read" &&
              (notes.length === 0 ? (
                <Empty label="No revision notes yet" />
              ) : (
                <ul>
                  {notes.map((n) => (
                    <PointRow key={n.id} title={n.title}>
                      <Link
                        to={
                          isDemoStudent() ? "/demo/student/notes/$conceptId" : "/notes/$conceptId"
                        }
                        params={{ conceptId: n.id }}
                        className={GO}
                      >
                        Read
                      </Link>
                    </PointRow>
                  ))}
                </ul>
              ))}

            {active === "quiz" &&
              (mcqSets.length === 0 ? (
                (practiceWaiting(practice, "quiz") && (
                  <PracticePanel practice={practice} kind="quiz" />
                )) || <Empty label="No MCQ sets yet" />
              ) : (
                <ul>
                  {mcqSets.map((s) => (
                    <PointRow
                      key={s.id}
                      title={s.title}
                      lead={
                        // Publishing is the tutor's business: a student only
                        // ever sees the published sets, so it says nothing to them.
                        isTutor ? (
                          <Chip
                            tint={s.published ? "tint-emerald" : "tint-slate"}
                            className="shrink-0"
                          >
                            {s.published ? "Published" : "Draft"}
                          </Chip>
                        ) : (
                          // Their best score, as on the MCQs page's quiz card.
                          taken[s.id] && (
                            <span className="chip chip-solid shrink-0">
                              <span className="numeral">{taken[s.id].pct}%</span>
                            </span>
                          )
                        )
                      }
                    >
                      {(s.published || isTutor) && (
                        <Link
                          to={isDemoStudent() ? "/demo/student/mcq/$setId" : "/mcq/$setId"}
                          params={{ setId: s.id }}
                          className={GO}
                        >
                          {/* Nothing is recorded for a tutor (TakeMcqPage). Inside
                              the week a taken quiz opens as its review (retakeLock). */}
                          {isTutor
                            ? "Preview"
                            : !taken[s.id]
                              ? "Take"
                              : taken[s.id].opensAt.getTime() > Date.now()
                                ? "Review"
                                : "Retake"}
                        </Link>
                      )}
                      {isTutor && (
                        <>
                          <button
                            onClick={() => publish(s.id, s.published)}
                            className="inline-flex items-center text-xs px-2.5 py-1.5 min-h-11 sm:pointer-fine:min-h-0 rounded-lg border border-border text-muted-foreground hover:text-foreground transition"
                          >
                            {s.published ? "Unpublish" : "Publish"}
                          </button>
                          {s.origin === "generated" && (
                            <button
                              onClick={() => replaceSet(s.id)}
                              disabled={replacingId !== null}
                              className="inline-flex items-center text-xs px-2.5 py-1.5 min-h-11 sm:pointer-fine:min-h-0 rounded-lg border border-border text-muted-foreground hover:text-foreground transition disabled:opacity-60"
                            >
                              {replacingId === s.id ? "Replacing…" : "Replace questions"}
                            </button>
                          )}
                          <button
                            onClick={() => delSet(s.id)}
                            aria-label={`Delete MCQ set ${s.title}`}
                            className="tap-target text-muted-foreground hover:text-destructive p-1 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </PointRow>
                  ))}
                </ul>
              ))}

            {active === "task" &&
              (tasks.length === 0 ? (
                (practiceWaiting(practice, "task") && (
                  <PracticePanel practice={practice} kind="task" />
                )) || <Empty label="No tasks yet" />
              ) : (
                <ul>
                  {tasks.map((r) => (
                    <PointRow
                      key={r.id}
                      title={r.title}
                      detail={r.description}
                      when={r.due_at ? `Due ${plannerDateLabel(new Date(r.due_at))}` : null}
                    >
                      <Link
                        to={
                          isDemoStudent()
                            ? "/demo/student/homework/$homeworkId"
                            : "/homework/$homeworkId"
                        }
                        params={{ homeworkId: r.id }}
                        className={GO}
                      >
                        Open
                      </Link>
                    </PointRow>
                  ))}
                </ul>
              ))}

            {active === "live" && (
              <ul>
                {sessions.map((r) => (
                  <PointRow
                    key={r.id}
                    title={r.title}
                    detail={r.description}
                    when={
                      r.starts_at
                        ? formatWhen(new Date(r.starts_at).getTime(), { uk: isTutor })
                        : null
                    }
                  >
                    <SessionJoinLink session={r} isTutor={isTutor} />
                  </PointRow>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {activeVideo && (
        <VideoModal
          embed={activeVideo.embed}
          title={activeVideo.title}
          description={activeVideo.description}
          onClose={() => setActiveVideo(null)}
        />
      )}

      {editingVideo && userId && (
        <SpecPointVideoEditor
          video={editingVideo.video}
          specPointId={point.id}
          taxonomy={taxonomy}
          userId={userId}
          onClose={() => setEditingVideo(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

/**
 * A lesson's Join on a spec point, by the same rule as every other Join
 * ({@link showsJoin}): a student's shows only while the lesson can be joined.
 * Ticking, so it appears on a page left open.
 */
function SessionJoinLink({ session, isTutor }: { session: Resource; isTutor: boolean }) {
  const now = useNow(30_000);
  if (!session.join_url || !showsJoin(session, isTutor, now)) return null;
  return (
    <a
      href={session.join_url}
      target="_blank"
      rel="noreferrer"
      onClick={joinClick(session.id)}
      className={GO}
    >
      Join
    </a>
  );
}

/** A tutor's word for a stop with nothing behind it. */
function Empty({ label }: { label: string }) {
  return <p className="font-display text-lg font-bold">{label}</p>;
}

/** One thing behind a stop: its name, a line or two about it, and its button. */
function PointRow({
  title,
  lead,
  detail,
  when,
  children,
}: {
  title: string;
  lead?: React.ReactNode;
  detail?: string | null;
  when?: string | null;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0 flex-1 basis-40">
        <p className="font-display flex items-center gap-2.5 text-lg leading-snug font-bold break-words">
          {lead}
          <span className="min-w-0">{title}</span>
        </p>
        {detail && <p className="mt-0.5 text-sm">{detail}</p>}
        {when && <p className="mt-0.5 text-sm font-bold">{when}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </li>
  );
}

/**
 * The dotted line the stops sit on. One gentle S per gap, stretched to run from
 * the middle of the first stop to the middle of the last.
 */
function TrailPath({ gaps }: { gaps: number }) {
  let d = "M0 20";
  for (let i = 0; i < gaps; i++) {
    const x = i * 100;
    const [up, down] = i % 2 ? [36, 4] : [4, 36];
    d += ` C${x + 30} ${up} ${x + 70} ${down} ${x + 100} 20`;
  }
  return (
    <svg
      aria-hidden
      className="point-trail-path"
      viewBox={`0 0 ${gaps * 100} 40`}
      preserveAspectRatio="none"
    >
      <path d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
