import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, ArrowRight, RotateCcw, CheckCircle2, Target, Sparkles } from "lucide-react";
import { WeeklyPlanDAL, type WeeklyPlan, type PlanPoint } from "@/lib/weeklyPlanDal";
import { PlannerDAL } from "@/lib/plannerDal";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { type PointCoverage, statusOf, summarize, verdictCopy } from "@/lib/planner/coverage";
import { addWeeks, weekKeyToDate, toDateKey, weekRangeLabel } from "@/lib/week";
import { TutorTake } from "./TutorTake";

/**
 * The end-of-week feedback area. It reads how the student actually did on this
 * week's spec points (homework + MCQ coverage), shows a plain-English verdict,
 * lets the student say whether they feel ready, and — if some points are still
 * shaky or untouched — carries just those into next week so nothing is dropped
 * before it's understood. Confirming "confident" nudges the covered points up on
 * the confidence board, closing the loop back to the termly plan.
 *
 * In `readOnly` mode (the tutor viewing a student) the self-report buttons are
 * hidden and the student's own reflection is shown instead; the tutor can still
 * carry weak points forward on the student's behalf.
 */
export function WeekReview({
  studentId,
  plan,
  points,
  coverage,
  subject,
  board,
  level,
  weekStart,
  onChanged,
  readOnly = false,
}: {
  studentId: string;
  plan: WeeklyPlan;
  points: PlanPoint[];
  coverage: Map<string, PointCoverage>;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  weekStart: string;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const summary = useMemo(
    () =>
      summarize(
        points.map((p) => ({
          specPointId: p.spec_point_id,
          coverage: coverage.get(p.spec_point_id),
        })),
      ),
    [points, coverage],
  );
  const copy = verdictCopy(summary.verdict, summary);

  const [coveredOk, setCoveredOk] = useState<boolean | null>(null);
  const [reflection, setReflection] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<null | "confident" | "practice" | "carry">(null);

  useEffect(() => {
    let alive = true;
    WeeklyPlanDAL.getCheckin(plan.id).then((c) => {
      if (!alive) return;
      setCoveredOk(c?.covered_ok ?? null);
      setReflection(c?.reflection ?? "");
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [plan.id]);

  const nextWeekLabel = weekRangeLabel(addWeeks(weekKeyToDate(weekStart), 1));

  const report = async (ok: boolean) => {
    setBusy(ok ? "confident" : "practice");
    try {
      await WeeklyPlanDAL.saveCheckin({
        planId: plan.id,
        coveredOk: ok,
        reflection: reflection.trim() || null,
        coverage: Object.fromEntries(
          points.map((p) => [p.spec_point_id, statusOf(coverage.get(p.spec_point_id))]),
        ),
        studentId,
      });
      setCoveredOk(ok);
      // Confirming confidence lifts the covered points on the board so the termly
      // plan reflects the progress — the "you covered these" signal.
      if (ok && summary.covered.length > 0) {
        await Promise.allSettled(
          summary.covered.map((id) => PlannerDAL.setSpecPointConfidence(id, 80)),
        );
      }
      toast.success(ok ? "Nice — marked as covered." : "Noted — we'll keep the focus on these.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that — try again.");
    } finally {
      setBusy(null);
    }
  };

  const carryForward = async () => {
    if (summary.toRevisit.length === 0) return;
    setBusy("carry");
    const nextStart = toDateKey(addWeeks(weekKeyToDate(weekStart), 1));
    try {
      const existing = await WeeklyPlanDAL.getPlan(studentId, subject, nextStart);
      if (existing) {
        await WeeklyPlanDAL.addPoints(existing.plan.id, summary.toRevisit, "carried_over");
      } else {
        await WeeklyPlanDAL.savePlan({
          subject,
          board,
          level,
          weekStart: nextStart,
          specPointIds: summary.toRevisit,
          source: readOnly ? "tutor" : "student",
          origin: "carried_over",
          studentId,
        });
      }
      toast.success(
        `Carried ${summary.toRevisit.length} ${
          summary.toRevisit.length === 1 ? "topic" : "topics"
        } into ${nextWeekLabel}.`,
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't carry those forward — try again.");
    } finally {
      setBusy(null);
    }
  };

  const anyActivity = summary.strong + summary.practised + summary.weak > 0;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">How this week went</h3>
      </div>

      {/* Verdict banner */}
      <div className={`rounded-xl border p-3.5 ${copy.tone}`}>
        <div className="flex items-start gap-2.5">
          {summary.verdict === "move_on" ? (
            <CheckCircle2 className={`w-5 h-5 mt-0.5 shrink-0 ${copy.accent}`} />
          ) : (
            <RotateCcw className={`w-5 h-5 mt-0.5 shrink-0 ${copy.accent}`} />
          )}
          <div>
            <p className={`text-sm font-semibold ${copy.accent}`}>{copy.headline}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{copy.sub}</p>
          </div>
        </div>
        {/* Coverage tally */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-border/60 text-[11px] text-muted-foreground">
          <Tally label="Nailed" n={summary.strong} tone="text-emerald-600 dark:text-emerald-400" />
          <Tally label="Practised" n={summary.practised} tone="text-sky-600 dark:text-sky-400" />
          <Tally label="Shaky" n={summary.weak} tone="text-amber-600 dark:text-amber-400" />
          <Tally label="Not done" n={summary.notDone} tone="text-muted-foreground" />
        </div>
      </div>

      {!anyActivity && (
        <p className="mt-3 text-xs text-muted-foreground">
          No homework or quizzes logged for these points yet — do some practice and check back, or
          tell us how you feel below.
        </p>
      )}

      {/* Student self-report */}
      {!readOnly ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            How do you feel about this week?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => report(true)}
              disabled={!!busy}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${
                coveredOk === true
                  ? "bg-emerald-600 text-white"
                  : "border border-border hover:bg-muted"
              }`}
            >
              {busy === "confident" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              I'm confident, move on
            </button>
            <button
              type="button"
              onClick={() => report(false)}
              disabled={!!busy}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${
                coveredOk === false
                  ? "bg-amber-500 text-white"
                  : "border border-border hover:bg-muted"
              }`}
            >
              {busy === "practice" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Target className="w-4 h-4" />
              )}
              I'd like more practice
            </button>
          </div>
          {coveredOk === true && summary.covered.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
              <Sparkles className="w-3 h-3" /> Marked {summary.covered.length} covered{" "}
              {summary.covered.length === 1 ? "point" : "points"} as stronger on your board.
            </p>
          )}
          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            onBlur={() => {
              if (loaded && coveredOk !== null)
                WeeklyPlanDAL.saveCheckin({
                  planId: plan.id,
                  coveredOk,
                  reflection: reflection.trim() || null,
                  studentId,
                }).catch(() => {});
            }}
            rows={2}
            placeholder="Anything you want to note about this week? (optional)"
            className="mt-2.5 w-full rounded-lg bg-card border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
          />
        </div>
      ) : (
        loaded && (
          <div className="mt-4 rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1">Student check-in</p>
            {coveredOk == null ? (
              <p className="text-sm text-muted-foreground">Not completed yet.</p>
            ) : (
              <p className="text-sm">
                {coveredOk ? "✅ Felt confident to move on" : "🎯 Wanted more practice"}
                {reflection && (
                  <span className="block text-muted-foreground mt-1">“{reflection}”</span>
                )}
              </p>
            )}
          </div>
        )
      )}

      {/* Ali's take — the personalized-tutoring voice on the week + next week */}
      <TutorTake
        studentId={studentId}
        plan={plan}
        subject={subject}
        board={board}
        level={level}
        weekStart={weekStart}
        isTutor={readOnly}
        onChanged={onChanged}
      />

      {/* Carry forward */}
      {summary.toRevisit.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-border/60">
          <button
            type="button"
            onClick={carryForward}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {busy === "carry" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            Carry {summary.toRevisit.length} into next week
          </button>
          <span className="text-[11px] text-muted-foreground">
            Keeps the shaky points in focus for {nextWeekLabel}.
          </span>
        </div>
      )}
    </div>
  );
}

function Tally({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`font-bold tabular-nums ${tone}`}>{n}</span>
      <span>{label}</span>
    </span>
  );
}
