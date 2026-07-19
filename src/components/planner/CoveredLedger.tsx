import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, ClipboardList, ListChecks, History, ChevronDown, RotateCcw } from "lucide-react";
import { ScheduleDAL, type CoveredTopic } from "@/lib/scheduleDal";
import { STRONG_THRESHOLD } from "@/lib/planner/coverage";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey } from "@/lib/week";

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

/**
 * "Covered so far" — a progress ledger under the termly confidence board. It
 * shows the spec points the student has actually practised (homework/MCQ), with
 * their best mark from each, grouped by topic. Where the confidence board is
 * forward-looking (how ready do I feel?), this is the record of what's been done
 * and how it went — the other half of the picture.
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

  const [data, setData] = useState<CoveredTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retaking, setRetaking] = useState<string | null>(null);

  const toggle = (topicId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });

  const retake = async (topic: CoveredTopic) => {
    if (!active) return;
    setRetaking(topic.topicId);
    try {
      const n = await ScheduleDAL.resurfaceTopic({
        studentId,
        topicId: topic.topicId,
        subject: active.subject as SubjectV,
        board: active.board as BoardV,
        level,
        weekStart: currentWeekKey(),
      });
      toast.success(
        `Added ${n} spec ${n === 1 ? "point" : "points"} from “${topic.title}” back into this week.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't set that up — try again.");
    } finally {
      setRetaking(null);
    }
  };

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    setExpanded(new Set());
    ScheduleDAL.getCoveredLedger({
      studentId,
      subject: active.subject as SubjectV,
      board: active.board as BoardV,
      level,
    })
      .then((d) => {
        if (alive) setData(d);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, active?.subject, active?.board, level]);

  if (!active) return null;

  const total = data.reduce((n, t) => n + t.points.length, 0);

  return (
    <div className="rounded-2xl bg-card border border-border p-4 sm:p-5 shadow-sm mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold tracking-tight">Covered so far</h2>
            <p className="text-xs text-muted-foreground">
              {total > 0
                ? `${total} spec ${total === 1 ? "point" : "points"} practised, and how each went.`
                : "What you've practised will build up here."}
            </p>
          </div>
        </div>
        {subject == null && ordered.length > 1 && (
          <div className="flex items-center gap-1.5">
            {ordered.map((e) => (
              <button
                key={e.subject}
                type="button"
                onClick={() => setPickedSubject(e.subject)}
                className={`h-8 px-3 rounded-lg text-sm font-medium transition ${
                  e.subject === activeSubject
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {subjectLabel[e.subject] ?? e.subject}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : total === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing logged yet — do some homework or a quiz and it'll show up here with your mark.
        </p>
      ) : (
        <div className="space-y-2.5">
          {data.map((t) => {
            const isOpen = expanded.has(t.topicId);
            const strongCount = t.points.filter(
              (p) =>
                (p.homeworkScore ?? 0) >= STRONG_THRESHOLD ||
                (p.quizScore ?? 0) >= STRONG_THRESHOLD,
            ).length;
            return (
              <div
                key={t.topicId}
                className="rounded-xl border border-border bg-muted/20 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(t.topicId)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left hover:bg-muted/40 transition"
                  aria-expanded={isOpen}
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold">{t.title}</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {t.points.length} {t.points.length === 1 ? "point" : "points"} practised ·{" "}
                      {strongCount} going well
                    </p>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-0.5 border-t border-border space-y-1.5">
                    {t.points.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">
                            {p.code}
                          </span>
                          <span className="text-sm">{p.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {p.homeworkScore != null && (
                            <ScoreChip icon="homework" score={p.homeworkScore} />
                          )}
                          {p.quizScore != null && <ScoreChip icon="quiz" score={p.quizScore} />}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => retake(t)}
                      disabled={retaking === t.topicId}
                      className="mt-1 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/40 disabled:opacity-50"
                      title="Bring this whole topic back into this week to revise it again"
                    >
                      {retaking === t.topicId ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      Retake this topic
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScoreChip({ icon, score }: { icon: "homework" | "quiz"; score: number }) {
  const strong = score >= STRONG_THRESHOLD;
  return (
    <span
      className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[11px] font-medium ${
        strong
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
          : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
      }`}
      title={`${icon === "homework" ? "Homework" : "Quiz"}: best ${score}%`}
    >
      {icon === "homework" ? (
        <ClipboardList className="w-3 h-3" />
      ) : (
        <ListChecks className="w-3 h-3" />
      )}
      <span className="tabular-nums font-semibold">{score}%</span>
    </span>
  );
}
