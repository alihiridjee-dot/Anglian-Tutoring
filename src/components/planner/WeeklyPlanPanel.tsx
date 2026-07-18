import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  X,
  ClipboardList,
  ListChecks,
  Wand2,
  Plus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Undo2,
  CheckCircle2,
} from "lucide-react";
import { WeeklyPlanDAL, type WeeklyPlan, type PlanPoint } from "@/lib/weeklyPlanDal";
import { ScheduleDAL } from "@/lib/scheduleDal";
import { interpretWeakness } from "@/lib/weeklyPlan.functions";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey, mondayOf, addWeeks, toDateKey, weekRangeLabel } from "@/lib/week";
import { type PointCoverage, statusOf } from "@/lib/planner/coverage";
import { CoveragePill } from "./CoveragePill";
import { WeekReview } from "./WeekReview";

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

type Activity = Map<string, { hasHomework: boolean; hasQuiz: boolean }>;

/**
 * "This week" — the student's editable weekly plan, now week-navigable. The
 * platform suggests the week's spec points from their confidence (or a free-text
 * description of what's tricky); the student adds/removes freely. Past weeks show
 * how each point went (coverage) plus the end-of-week review, and let the student
 * pull any point back into focus. Future weeks can be planned ahead. Nothing is
 * fixed — re-suggesting or editing just rewrites that week's row.
 */
export function WeeklyPlanPanel({
  studentId,
  enrolments,
  level,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
}) {
  const ordered = useMemo(
    () => [
      ...enrolments.filter((e) => e.subject === "biology"),
      ...enrolments.filter((e) => e.subject !== "biology"),
    ],
    [enrolments],
  );
  const [activeSubject, setActiveSubject] = useState(ordered[0]?.subject ?? "biology");
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];

  // 0 = this week, -1 = last week, +1 = next week…
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = toDateKey(addWeeks(mondayOf(), weekOffset));
  const weekLabel = weekRangeLabel(addWeeks(mondayOf(), weekOffset));
  const isCurrent = weekOffset === 0;
  const isPast = weekOffset < 0;
  const isFuture = weekOffset > 0;
  const editable = !isPast; // history is read-only (but you can pull points forward)
  const showReview = weekOffset <= 0; // review current + past weeks

  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [points, setPoints] = useState<PlanPoint[]>([]);
  const [activity, setActivity] = useState<Activity>(new Map());
  const [coverage, setCoverage] = useState<Map<string, PointCoverage>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "suggest" | "weakness">(null);
  const [weakness, setWeakness] = useState("");
  const [showWeakness, setShowWeakness] = useState(false);

  const weaknessFn = useServerFn(interpretWeakness);

  const reload = async () => {
    if (!active) return;
    setLoading(true);
    const res = await WeeklyPlanDAL.getPlan(studentId, active.subject as SubjectV, weekStart);
    const pts = res?.points ?? [];
    setPlan(res?.plan ?? null);
    setPoints(pts);
    const ids = pts.map((p) => p.spec_point_id);
    // Fold any new homework/MCQ results into the spaced-repetition schedule first
    // (idempotent), so coverage below and the next suggestion reflect them.
    if (showReview && ids.length) {
      await ScheduleDAL.syncReviewsFromAttempts(studentId, ids).catch(() => {});
    }
    const [act, cov] = await Promise.all([
      WeeklyPlanDAL.getActivity(ids),
      showReview && ids.length
        ? WeeklyPlanDAL.getCoverage(studentId, ids)
        : Promise.resolve(new Map()),
    ]);
    setActivity(act);
    setCoverage(cov);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, active?.subject, active?.board, weekStart]);

  const doSuggest = async () => {
    if (!active) return;
    setBusy("suggest");
    try {
      const monday = addWeeks(mondayOf(), weekOffset);
      const weekEnd = new Date(monday);
      weekEnd.setDate(monday.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      // Deterministic spaced-repetition engine: weakest / most-overdue first,
      // lighter on what's already sticking. Runs locally, no AI dependency.
      const ids = await ScheduleDAL.suggestForWeek({
        studentId,
        subject: active.subject as SubjectV,
        board: active.board as BoardV,
        level,
        weekEnd,
        targetCount: 6,
      });
      if (!ids.length) {
        toast.info("Rate a few topics first so we've got something to plan from.");
        return;
      }
      await WeeklyPlanDAL.savePlan({
        subject: active.subject as SubjectV,
        board: active.board as BoardV,
        level,
        weekStart,
        specPointIds: ids,
        source: "ai",
        rationale:
          "Led with your weakest and due-for-review topics, and went lighter on the ones that are already sticking.",
        origin: "ai",
      });
      toast.success(`Planned ${ids.length} topics for this week.`);
      setShowWeakness(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't build a plan — try again.");
    } finally {
      setBusy(null);
    }
  };

  const doWeakness = async () => {
    if (!active || !weakness.trim()) return;
    setBusy("weakness");
    try {
      const r = await weaknessFn({
        data: {
          subject: active.subject as SubjectV,
          board: active.board as BoardV,
          level,
          text: weakness.trim(),
        },
      });
      if (!r.specPointIds.length) {
        toast.info("Couldn't match that to any spec points — try describing it differently.");
        return;
      }
      if (plan) {
        await WeeklyPlanDAL.addPoints(plan.id, r.specPointIds, "student");
      } else {
        await WeeklyPlanDAL.savePlan({
          subject: active.subject as SubjectV,
          board: active.board as BoardV,
          level,
          weekStart,
          specPointIds: r.specPointIds,
          source: "student",
          origin: "student",
        });
      }
      toast.success(`Added ${r.specPointIds.length} topics.`);
      setWeakness("");
      setShowWeakness(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add those — try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (specPointId: string) => {
    if (!plan) return;
    setPoints((prev) => prev.filter((p) => p.spec_point_id !== specPointId));
    try {
      await WeeklyPlanDAL.removePoint(plan.id, specPointId);
    } catch {
      await reload();
    }
  };

  // Pull a past-week point back into this week's plan.
  const focusAgain = async (point: PlanPoint) => {
    const curStart = currentWeekKey();
    try {
      const cur = await WeeklyPlanDAL.getPlan(studentId, active!.subject as SubjectV, curStart);
      if (cur) {
        await WeeklyPlanDAL.addPoints(cur.plan.id, [point.spec_point_id], "carried_over");
      } else {
        await WeeklyPlanDAL.savePlan({
          subject: active!.subject as SubjectV,
          board: active!.board as BoardV,
          level,
          weekStart: curStart,
          specPointIds: [point.spec_point_id],
          source: "student",
          origin: "carried_over",
        });
      }
      toast.success(`Added “${point.code}” back into this week.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add that back — try again.");
    }
  };

  // Group points by topic for display.
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; points: PlanPoint[] }>();
    for (const p of points) {
      const g = m.get(p.topic_id) ?? { title: p.topic_title ?? "—", points: [] };
      g.points.push(p);
      m.set(p.topic_id, g);
    }
    return [...m.values()];
  }, [points]);

  if (!active) return null;

  return (
    <div className="rounded-2xl bg-card border border-border p-4 sm:p-5 shadow-sm mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <CalendarRange className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="font-display text-base font-semibold tracking-tight">
                {isCurrent ? "This week" : isPast ? "Past week" : "Upcoming week"}
              </h2>
              {!isCurrent && (
                <button
                  type="button"
                  onClick={() => setWeekOffset(0)}
                  className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  <Undo2 className="w-3 h-3" /> Today
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{weekLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {ordered.length > 1 && (
            <div className="flex items-center gap-1.5">
              {ordered.map((e) => (
                <button
                  key={e.subject}
                  type="button"
                  onClick={() => setActiveSubject(e.subject)}
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w - 1)}
              className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
              aria-label="Previous week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w + 1)}
              className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
              aria-label="Next week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : points.length === 0 ? (
        editable ? (
          <EmptyState busy={busy} onSuggest={doSuggest} future={isFuture} />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No plan was set for this week.
          </p>
        )
      ) : (
        <div className="space-y-4">
          {plan?.ai_rationale && isCurrent && (
            <div className="flex items-start gap-2 rounded-xl bg-primary/5 border border-primary/15 p-3">
              <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <p className="text-sm text-foreground/90">{plan.ai_rationale}</p>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.title}>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                {g.title}
              </h3>
              <div className="space-y-1.5">
                {g.points.map((p) => {
                  const a = activity.get(p.spec_point_id);
                  const cov = coverage.get(p.spec_point_id);
                  return (
                    <div
                      key={p.spec_point_id}
                      className="group flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-2.5"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">
                          {p.code}
                        </span>
                        <span className="text-sm">{p.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {showReview && (
                          <CoveragePill status={statusOf(cov)} score={cov?.bestScore} />
                        )}
                        {a?.hasHomework &&
                          (() => {
                            const done = showReview && cov?.homeworkDone;
                            return (
                              <Link
                                to="/homework"
                                className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[11px] font-medium ${
                                  done
                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                                    : "bg-card border-border text-muted-foreground hover:text-foreground"
                                }`}
                                title={done ? "Homework completed" : "Homework available"}
                              >
                                {done ? (
                                  <CheckCircle2 className="w-3 h-3" />
                                ) : (
                                  <ClipboardList className="w-3 h-3" />
                                )}
                                Homework
                                {done && cov?.homeworkScore != null && (
                                  <span className="tabular-nums font-semibold">
                                    {cov.homeworkScore}%
                                  </span>
                                )}
                              </Link>
                            );
                          })()}
                        {a?.hasQuiz &&
                          (() => {
                            const done = showReview && cov?.quizDone;
                            return (
                              <Link
                                to="/mcqs"
                                className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[11px] font-medium ${
                                  done
                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                                    : "bg-card border-border text-muted-foreground hover:text-foreground"
                                }`}
                                title={done ? "Quiz completed" : "Quiz available"}
                              >
                                {done ? (
                                  <CheckCircle2 className="w-3 h-3" />
                                ) : (
                                  <ListChecks className="w-3 h-3" />
                                )}
                                Quiz
                                {done && cov?.quizScore != null && (
                                  <span className="tabular-nums font-semibold">
                                    {cov.quizScore}%
                                  </span>
                                )}
                              </Link>
                            );
                          })()}
                        {isPast && (
                          <button
                            type="button"
                            onClick={() => focusAgain(p)}
                            className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-card border border-border text-[11px] font-medium text-muted-foreground hover:text-primary hover:border-primary/40"
                            title="Focus on this again this week"
                          >
                            <RotateCcw className="w-3 h-3" /> Focus again
                          </button>
                        )}
                        {editable && (
                          <button
                            type="button"
                            onClick={() => remove(p.spec_point_id)}
                            className="w-6 h-6 rounded-md text-muted-foreground/50 hover:text-rose-500 hover:bg-rose-500/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                            aria-label="Remove from this week"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {editable && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={doSuggest}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {busy === "suggest" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                Re-suggest
              </button>
              <button
                type="button"
                onClick={() => setShowWeakness((s) => !s)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted"
              >
                <Plus className="w-4 h-4" /> Add what's tricky
              </button>
            </div>
          )}

          {showReview && plan && (
            <WeekReview
              studentId={studentId}
              plan={plan}
              points={points}
              coverage={coverage}
              subject={active.subject as SubjectV}
              board={active.board as BoardV}
              level={level}
              weekStart={weekStart}
              onChanged={reload}
            />
          )}
        </div>
      )}

      {showWeakness && editable && (
        <WeaknessInput
          value={weakness}
          onChange={setWeakness}
          busy={busy === "weakness"}
          onSubmit={doWeakness}
        />
      )}
    </div>
  );
}

function EmptyState({
  busy,
  onSuggest,
  future,
}: {
  busy: null | "suggest" | "weakness";
  onSuggest: () => void;
  future: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
        <Sparkles className="w-5 h-5" />
      </div>
      <p className="text-sm font-medium mb-1">
        {future ? "Nothing planned for this week yet" : "No plan for this week yet"}
      </p>
      <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
        We'll suggest a week of topics from how you rated your confidence — then you can tweak it
        however you like.
      </p>
      <button
        type="button"
        onClick={onSuggest}
        disabled={!!busy}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
      >
        {busy === "suggest" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Sparkles className="w-4 h-4" />
        )}
        Suggest {future ? "this week" : "my week"}
      </button>
    </div>
  );
}

function WeaknessInput({
  value,
  onChange,
  busy,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
      <label className="text-xs font-semibold text-muted-foreground">
        Tell us what you're finding tricky
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="e.g. I don't really get respiration, and enzymes confuse me"
        className="mt-1.5 w-full rounded-lg bg-card border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !value.trim()}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          Add to my week
        </button>
      </div>
    </div>
  );
}
