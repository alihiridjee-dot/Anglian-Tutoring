import { EmptyState, ErrorNote } from "@/components/Shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { progressQuery, invalidatePlanner } from "@/lib/planner/queries";
import { Spinner } from "@/components/Shared";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, ListChecks, Check, ChevronDown, RotateCcw } from "lucide-react";
import { type ProgressPoint, type TopicProgress } from "@/lib/planner/scheduleDal";
import { WeeklyPlanDAL } from "@/lib/planner/weeklyPlanDal";
import { isDueBy, retrievability } from "@/lib/planner/scheduler";
import { type Enrolment } from "@/lib/profile/enrolment";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { currentWeekKey } from "@/lib/planner/week";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { useNow } from "@/hooks/useNow";

/** A point is done once it has a homework or quiz mark behind it. */
const isDone = (p: ProgressPoint) =>
  p.lastReviewedAt != null && (p.homeworkScore != null || p.quizScore != null);

/**
 * A review is due when a practised point's memory card has come round again —
 * the same rule the planner's memory stats count as "due now". Never-practised
 * points have no card to review, so they are new work, not a review.
 */
const isReviewDue = (p: ProgressPoint, now: Date) =>
  retrievability(p.card, now) !== null && isDueBy(p.card, now);

/**
 * Every topic and specification point in the course as one scrollable table:
 * a tick for each point the student has done, and how many reviews each topic
 * has due. Topics collapse so the whole course fits on a screen.
 */
export function CoveredLedger({
  studentId,
  enrolments,
  level,
  subject,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  /** When set, the subject is controlled by the parent and the tabs are hidden. */
  subject?: string;
}) {
  const ordered = useMemo(
    () => [
      ...enrolments.filter((e) => e.subject === "biology"),
      ...enrolments.filter((e) => e.subject !== "biology"),
    ],
    [enrolments],
  );
  const [pickedSubject, setPickedSubject] = useState(ordered[0]?.subject ?? "biology");
  const activeSubject = subject ?? pickedSubject;
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];

  // Reset to the first subject when the student changes — the tutor's planner
  // reuses this component across students, so a prior pick must not carry over
  // (otherwise it queries the wrong subject and looks empty).
  useEffect(() => {
    setPickedSubject(ordered[0]?.subject ?? "biology");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const queryClient = useQueryClient();
  const params = {
    studentId,
    subject: (active?.subject ?? "biology") as SubjectV,
    board: (active?.board ?? "aqa") as BoardV,
    level,
  };
  // The planner's own progress read: refetched whenever a homework or quiz
  // lands (invalidatePlanner), so ticks and due counts follow the work.
  const progress = useQuery({ ...progressQuery(params), enabled: !!active });
  const data = progress.data ?? [];
  // Reviews come due with the clock, not only with new work.
  const now = new Date(useNow(60_000));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retaking, setRetaking] = useState<string | null>(null);

  const toggle = (topicId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });

  const retake = async (topic: TopicProgress) => {
    if (!active) return;
    setRetaking(topic.topicId);
    try {
      const n = await WeeklyPlanDAL.resurfaceTopic({
        studentId,
        topicId: topic.topicId,
        subject: active.subject as SubjectV,
        board: active.board as BoardV,
        level,
        weekStart: currentWeekKey(),
      });
      await invalidatePlanner(queryClient, studentId);
      toast.success(
        n === 0
          ? `“${topic.title}” is already in this week.`
          : `Added ${n} spec ${n === 1 ? "point" : "points"} from “${topic.title}” back into this week.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't set that up — try again.");
    } finally {
      setRetaking(null);
    }
  };

  if (!active) return null;
  if (progress.error)
    return <ErrorNote error={progress.error} onRetry={() => void progress.refetch()} />;

  const points = data.flatMap((t) => t.points);
  const doneTotal = points.filter(isDone).length;
  const dueTotal = points.filter((p) => isReviewDue(p, now)).length;

  return (
    <div className="tint-emerald rounded-2xl premium-card shadow-sm mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="icon-tile size-9 shrink-0">
            <ListChecks className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Course checklist</h2>
            {points.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                <span className="chip text-sm!">
                  <Check className="size-4" strokeWidth={3} aria-hidden />
                  {doneTotal} of {points.length} done
                </span>
                {dueTotal > 0 && (
                  <span className="chip tint-amber text-sm!">
                    {dueTotal} {dueTotal === 1 ? "review" : "reviews"} due
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {subject == null && ordered.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            {ordered.map((e) => (
              <button
                key={e.subject}
                type="button"
                onClick={() => setPickedSubject(e.subject)}
                className={`h-11 sm:h-8 px-3 rounded-lg text-sm font-medium transition ${
                  e.subject === activeSubject
                    ? "btn-solid"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {subjectLabel(e.subject)}
              </button>
            ))}
          </div>
        )}
      </div>

      {progress.isLoading ? (
        <Spinner className="py-8" />
      ) : points.length === 0 ? (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <EmptyState
            mascot="owl"
            mood="sleepy"
            title="No spec points yet"
            body="This course has no topics loaded."
          />
        </div>
      ) : (
        <div className="scroll-slim max-h-[34rem] overflow-y-auto border-t border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground text-xs tracking-widest uppercase">
              <tr>
                <th className="px-3 sm:px-5 py-3 text-left">
                  <span className="sm:hidden">Topic</span>
                  <span className="hidden sm:inline">Topic / spec point</span>
                </th>
                <th className="w-14 px-1 py-3 text-center sm:w-20 sm:px-2">Done</th>
                <th className="w-14 px-2 py-3 text-center whitespace-nowrap sm:w-36 sm:px-5">
                  <span className="sm:hidden">Due</span>
                  <span className="hidden sm:inline">Reviews due</span>
                </th>
              </tr>
            </thead>
            {data.map((t) => {
              const isOpen = expanded.has(t.topicId);
              const done = t.points.filter(isDone).length;
              const due = t.points.filter((p) => isReviewDue(p, now)).length;
              return (
                <tbody key={t.topicId} className="border-b border-foreground/20 last:border-b-0">
                  <tr
                    onClick={() => toggle(t.topicId)}
                    className="cursor-pointer hover:bg-muted/30"
                  >
                    <td className="px-3 sm:px-5 py-3">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <ChevronDown
                          className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                            isOpen ? "" : "-rotate-90"
                          }`}
                          aria-hidden
                        />
                        <span className="min-w-0 font-medium">{t.title}</span>
                      </button>
                    </td>
                    {/* A finished topic gets the tick; any other shows how far
                        through it is — green once started, neutral at zero. */}
                    <td className="px-1 py-3 text-center sm:px-2">
                      {t.points.length > 0 && done === t.points.length ? (
                        <Tick done />
                      ) : (
                        <span className={`chip numeral ${done === 0 ? "tint-slate" : ""}`}>
                          {done}/{t.points.length}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center sm:px-5">
                      {due > 0 ? (
                        <span className="chip tint-amber numeral">{due}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                  {isOpen &&
                    t.points.map((p) => (
                      <tr key={p.id} className="bg-muted/20">
                        <td className="py-2.5 pr-2 pl-9 sm:pr-5 sm:pl-11">
                          <span className="mr-1.5 text-[11px] font-bold whitespace-nowrap text-muted-foreground">
                            {p.code}
                          </span>
                          {p.title}
                        </td>
                        <td className="px-1 py-2.5 text-center sm:px-2">
                          <Tick done={isDone(p)} title={markTitle(p)} />
                        </td>
                        <td className="px-2 py-2.5 text-center sm:px-5">
                          {isReviewDue(p, now) && (
                            <span className="chip tint-amber text-[10px]">Due</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  {isOpen && done > 0 && (
                    <tr className="bg-muted/20">
                      <td colSpan={3} className="pt-1 pr-4 pb-3 pl-9 sm:pl-11">
                        <button
                          type="button"
                          onClick={() => retake(t)}
                          disabled={retaking === t.topicId}
                          className="inline-flex items-center gap-1.5 h-11 sm:h-8 px-3 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/40 disabled:opacity-50"
                          title="Bring this whole topic back into this week to revise it again"
                        >
                          {retaking === t.topicId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" />
                          )}
                          Retake this topic
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );
}

/** Best marks behind a done point, shown on hover over its tick. */
function markTitle(p: ProgressPoint) {
  const marks = [
    p.homeworkScore != null ? `Task best ${p.homeworkScore}%` : null,
    p.quizScore != null ? `Quiz best ${p.quizScore}%` : null,
  ].filter(Boolean);
  return marks.length > 0 ? marks.join(" · ") : undefined;
}

/** A read-only checkbox: filled in the card's tint once the work is done. */
function Tick({ done, title }: { done: boolean; title?: string }) {
  return (
    <span
      role="img"
      aria-label={done ? "Done" : "Not done"}
      title={title}
      className={`inline-flex size-5 items-center justify-center rounded-[6px] border-[1.5px] ${
        done
          ? "border-[color:var(--tint)] bg-[color:var(--tint)] text-white"
          : "border-border bg-card"
      }`}
    >
      {done && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
    </span>
  );
}
