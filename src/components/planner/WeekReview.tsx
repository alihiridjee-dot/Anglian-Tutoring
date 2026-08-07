import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Target,
  Lock,
  Send,
  CircleDot,
  Repeat,
  Plus,
  MinusCircle,
} from "lucide-react";
import {
  WeeklyPlanDAL,
  type WeeklyPlan,
  type PlanPoint,
  type PlanPointOrigin,
} from "@/lib/weeklyPlanDal";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import {
  statusOfPoint,
  summarize,
  verdictCopy,
  laneOf,
  carryOrigin,
  BREAKDOWN,
  LANE_LABEL,
  STATUS_STYLE,
  type PointCoverage,
  type Lane,
  type WeekSummary,
} from "@/lib/planner/coverage";
import { reviewLock } from "@/lib/planner/reviewLock";
import { addWeeks, weekKeyToDate, toDateKey, weekRangeLabel } from "@/lib/week";
import { TutorTake } from "./TutorTake";
import { type Activity } from "./useWeekPlan";

/**
 * The end-of-week feedback area. It reads how the student actually did on this
 * week's spec points (homework + MCQ coverage), reports it **per lane** — the
 * course and the revision are different questions — lets the student say whether
 * they feel ready and send a note to their tutor, and carries whatever is still
 * loose into next week without losing the lane it came from.
 *
 * Two things it deliberately does *not* do:
 *
 *  • It never opens mid-week ({@link reviewLock}). A verdict on an unfinished
 *    week grades work the student still has days to do.
 *  • It never writes to the confidence board. The check-in is a self-report on a
 *    week; the board is a deliberate per-point rating. Letting one tap of "I feel
 *    fine" overwrite every point at 80 silently rewrote ratings the student had
 *    thought about individually — and, because confidence anchors mastery and
 *    nothing ever refreshes it, that number then sat there for good.
 *
 * In `readOnly` mode (the tutor viewing a student) the lock and the self-report
 * are skipped and the student's own reflection is shown in the feedback editor
 * instead; the tutor can still carry weak points forward on their behalf.
 */
export function WeekReview({
  studentId,
  plan,
  points,
  coverage,
  activity,
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
  /** What practice exists per point — tells "not done" from "nothing was set". */
  activity: Activity;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  weekStart: string;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const entriesOf = useCallback(
    (list: PlanPoint[]) =>
      list.map((p) => ({
        specPointId: p.spec_point_id,
        coverage: coverage.get(p.spec_point_id),
        activity: activity.get(p.spec_point_id),
      })),
    [coverage, activity],
  );

  /** The week as a whole — drives the carry-forward and the coverage snapshot. */
  const summary = useMemo(() => summarize(entriesOf(points)), [points, entriesOf]);

  /**
   * The same read, split the way the plan itself is split. Falling behind on the
   * course and failing your revision are different problems with different
   * answers, and averaging them into one banner answers neither.
   */
  const lanes = useMemo(() => {
    const order: Lane[] = ["core", "focus", "yours"];
    return order
      .map((lane) => ({ lane, points: points.filter((p) => laneOf(p.origin) === lane) }))
      .filter((g) => g.points.length > 0)
      .map((g) => ({ ...g, summary: summarize(entriesOf(g.points)) }));
  }, [points, entriesOf]);

  const lock = useMemo(
    () =>
      reviewLock({
        weekStart,
        entries: points.map((p) => ({
          coverage: coverage.get(p.spec_point_id),
          activity: activity.get(p.spec_point_id),
        })),
      }),
    [weekStart, points, coverage, activity],
  );
  // The tutor is not being marked, so nothing is withheld from them.
  const locked = !readOnly && lock.locked;

  // Per-point performance, fed to the tutor's "Draft with AI" feedback.
  const metrics = useMemo(
    () =>
      points.map((p) => {
        const c = coverage.get(p.spec_point_id);
        return {
          code: p.code,
          title: p.title,
          topic: p.topic_title,
          status: statusOfPoint(c, activity.get(p.spec_point_id)),
          homeworkScore: c?.homeworkScore ?? null,
          quizScore: c?.quizScore ?? null,
        };
      }),
    [points, coverage, activity],
  );

  const [coveredOk, setCoveredOk] = useState<boolean | null>(null);
  const [reflection, setReflection] = useState("");
  /** What the tutor can already see, so we only save when it actually changed. */
  const [sentReflection, setSentReflection] = useState("");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "sent">("idle");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<null | "confident" | "practice" | "carry">(null);

  useEffect(() => {
    let alive = true;
    WeeklyPlanDAL.getCheckin(plan.id).then((c) => {
      if (!alive) return;
      setCoveredOk(c?.covered_ok ?? null);
      setReflection(c?.reflection ?? "");
      setSentReflection(c?.reflection ?? "");
      setNoteState(c?.reflection ? "sent" : "idle");
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [plan.id]);

  const nextWeekLabel = weekRangeLabel(addWeeks(weekKeyToDate(weekStart), 1));

  const coverageSnapshot = () =>
    Object.fromEntries(
      points.map((p) => [
        p.spec_point_id,
        statusOfPoint(coverage.get(p.spec_point_id), activity.get(p.spec_point_id)),
      ]),
    );

  const report = async (ok: boolean) => {
    setBusy(ok ? "confident" : "practice");
    try {
      await WeeklyPlanDAL.saveCheckin({
        planId: plan.id,
        coveredOk: ok,
        reflection: reflection.trim() || null,
        coverage: coverageSnapshot(),
        studentId,
      });
      setCoveredOk(ok);
      setSentReflection(reflection.trim());
      if (reflection.trim()) setNoteState("sent");
      toast.success(ok ? "Nice — marked as covered." : "Noted — we'll keep the focus on these.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that — try again.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Save the note on its way out of the field.
   *
   * This used to bail unless a feel-button had been pressed, so a student who
   * typed a note and navigated away lost it silently — the single most "into the
   * void" thing the card did. A check-in row with no verdict yet is perfectly
   * valid (`covered_ok` is nullable), so there is nothing to wait for.
   */
  const saveNote = async () => {
    const text = reflection.trim();
    if (!loaded || text === sentReflection) return;
    setNoteState("saving");
    try {
      await WeeklyPlanDAL.saveCheckin({
        planId: plan.id,
        coveredOk,
        reflection: text || null,
        coverage: coverageSnapshot(),
        studentId,
      });
      setSentReflection(text);
      setNoteState(text ? "sent" : "idle");
    } catch {
      setNoteState("idle");
      toast.error("Couldn't send that note — try again.");
    }
  };

  /**
   * Carry the loose points into next week, each staying in the lane it was in.
   *
   * Everything used to land on `origin: "carried_over"`, which is not a lane —
   * so a shaky *core* point left the core column for the neutral "Added by you"
   * box, and since the year plan gives each spec point exactly one week, it never
   * came back. The lane now rides along and the carry itself is recorded in
   * `carried_from`.
   */
  const carryForward = async () => {
    if (summary.toRevisit.length === 0) return;
    setBusy("carry");
    const nextStart = toDateKey(addWeeks(weekKeyToDate(weekStart), 1));
    const carrying = new Set(summary.toRevisit);
    const origins: Record<string, PlanPointOrigin> = {};
    for (const p of points) {
      if (carrying.has(p.spec_point_id)) origins[p.spec_point_id] = carryOrigin(p.origin);
    }
    try {
      const existing = await WeeklyPlanDAL.getPlan(studentId, subject, nextStart);
      if (existing) {
        await WeeklyPlanDAL.addPoints(existing.plan.id, summary.toRevisit, "student", {
          origins,
          carriedFrom: weekStart,
        });
      } else {
        await WeeklyPlanDAL.savePlan({
          subject,
          board,
          level,
          weekStart: nextStart,
          specPointIds: summary.toRevisit,
          source: readOnly ? "tutor" : "student",
          origins,
          origin: "student",
          carriedFrom: weekStart,
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

  return (
    <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {readOnly ? "This week's performance" : "How this week went"}
        </h3>
      </div>

      {locked ? (
        <LockedCard lock={lock} />
      ) : (
        <>
          <div className="space-y-3">
            {lanes.map((g) => (
              <LaneReview
                key={g.lane}
                lane={g.lane}
                summary={g.summary}
                readOnly={readOnly}
                pointCount={g.points.length}
              />
            ))}
          </div>

          {!readOnly && (
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

              {/* The note goes to a person, and says so. */}
              <div className="mt-3.5 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Send className="w-3.5 h-3.5 text-primary" />
                  <p className="text-xs font-semibold">Message your tutor about this week</p>
                  {noteState === "saving" && (
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />
                  )}
                  {noteState === "sent" && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> Sent to your tutor
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Ali reads this alongside your marks and replies here as "Ali's take".
                </p>
                <textarea
                  value={reflection}
                  onChange={(e) => {
                    setReflection(e.target.value);
                    if (noteState === "sent") setNoteState("idle");
                  }}
                  onBlur={saveNote}
                  rows={2}
                  placeholder="e.g. I got stuck on the meiosis diagram questions — could we go over them?"
                  className="w-full rounded-lg premium-input px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Ali's take — the personalized-tutoring voice on the week + next week.
          Shown even while the review is locked: it's the tutor talking to the
          student, not a verdict being passed on them. */}
      <TutorTake
        studentId={studentId}
        plan={plan}
        subject={subject}
        board={board}
        level={level}
        weekStart={weekStart}
        isTutor={readOnly}
        onChanged={onChanged}
        metrics={metrics}
        studentReflection={sentReflection || null}
        studentFeltReady={coveredOk}
      />

      {!locked && summary.toRevisit.length > 0 && (
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
            Keeps them in focus for {nextWeekLabel}, in the same lane they're in now.
          </span>
        </div>
      )}
    </div>
  );
}

const LANE_ICON: Record<Lane, typeof CircleDot> = {
  core: CircleDot,
  focus: Repeat,
  yours: Plus,
};

const LANE_ACCENT: Record<Lane, string> = {
  core: "text-primary",
  focus: "text-rose-600 dark:text-rose-400",
  yours: "text-muted-foreground",
};

/** One lane's verdict and tally — the same anatomy for all three. */
function LaneReview({
  lane,
  summary,
  readOnly,
  pointCount,
}: {
  lane: Lane;
  summary: WeekSummary;
  readOnly: boolean;
  pointCount: number;
}) {
  const copy = verdictCopy(summary.verdict, summary);
  const Icon = LANE_ICON[lane];
  const headline = readOnly ? tutorHeadline(summary) : copy.headline;
  const sub = readOnly
    ? "Based on this week's homework and quiz marks on these spec points."
    : copy.sub;

  return (
    <div className={`rounded-xl border p-3.5 ${copy.tone}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`w-3.5 h-3.5 ${LANE_ACCENT[lane]}`} />
        <span className={`text-[10px] font-bold uppercase tracking-wide ${LANE_ACCENT[lane]}`}>
          {LANE_LABEL[lane]}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {pointCount} {pointCount === 1 ? "point" : "points"}
        </span>
      </div>
      <div className="flex items-start gap-2.5">
        {summary.verdict === "move_on" ? (
          <CheckCircle2 className={`w-5 h-5 mt-0.5 shrink-0 ${copy.accent}`} />
        ) : summary.verdict === "no_signal" ? (
          <MinusCircle className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <RotateCcw className={`w-5 h-5 mt-0.5 shrink-0 ${copy.accent}`} />
        )}
        <div>
          <p className={`text-sm font-semibold ${copy.accent}`}>{headline}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        </div>
      </div>
      <CoverageBar summary={summary} />
    </div>
  );
}

/**
 * The lane's spec points as one bar, then a line per band explaining itself.
 *
 * The bar carries the shape of the week at a glance — how much is green, how
 * much isn't — and the key underneath carries the meaning, because a bare tally
 * reading "1 Practised" only makes sense to whoever wrote the rule. Bands with a
 * count of zero are left out entirely: a row of noughts is noise, and it was the
 * reason the old card led with "0 Nailed 0 Practised 0 Shaky".
 */
function CoverageBar({ summary }: { summary: WeekSummary }) {
  const bands = BREAKDOWN.map((b) => ({
    status: b.status,
    n: b.count(summary),
    ...STATUS_STYLE[b.status],
  })).filter((b) => b.n > 0);
  if (bands.length === 0) return null;
  const total = Math.max(1, summary.total);

  return (
    <div className="mt-3 pt-3 border-t border-border/60">
      <div className="flex h-2.5 gap-0.5 rounded-full overflow-hidden bg-muted/60">
        {bands.map((b) => (
          <div
            key={b.status}
            className={b.dot}
            style={{ width: `${(b.n / total) * 100}%` }}
            title={`${b.n} ${b.label} — ${b.meaning}`}
          />
        ))}
      </div>
      <ul className="mt-2.5 space-y-1">
        {bands.map((b) => (
          <li key={b.status} className="flex items-center gap-2 text-[11px] leading-tight">
            <span className={`w-2 h-2 rounded-full shrink-0 ${b.dot}`} />
            <span className="font-bold tabular-nums">{b.n}</span>
            <span className="font-semibold">{b.label}</span>
            <span className="text-muted-foreground truncate">— {b.meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The same objective read, framed for the tutor rather than encouragingly. */
function tutorHeadline(s: WeekSummary): string {
  switch (s.verdict) {
    case "no_signal":
      return "No homework or quizzes set on these points";
    case "move_on":
      return "On track — all planned points covered";
    case "almost":
      return "Mostly covered — a few points to revisit";
    default:
      return "Needs work — points still shaky or not done";
  }
}

/**
 * Why the review is shut, and what opens it.
 *
 * Deliberately specific: "opens Sunday" alone reads as an arbitrary gate, while
 * "two homeworks left" is a thing the student can act on this afternoon.
 */
function LockedCard({ lock }: { lock: ReturnType<typeof reviewLock> }) {
  const opens = lock.opensOn.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  const outstanding = lock.homeworkTotal - lock.homeworkDone;
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
      <div className="flex items-start gap-2.5">
        <Lock className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Your week in review opens {opens}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lock.homeworkTotal === 0
              ? "There's still time left in this week, so there's nothing to sum up yet."
              : outstanding === 1
                ? "One homework still to hand in — finish it and this opens straight away."
                : `${outstanding} homeworks still to hand in — finish them and this opens straight away.`}
          </p>
        </div>
      </div>
      {lock.homeworkTotal > 0 && (
        <div className="mt-3 pt-3 border-t border-border/60">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-muted-foreground">Homework handed in</span>
            <span className="font-semibold tabular-nums">
              {lock.homeworkDone} of {lock.homeworkTotal}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${Math.max(2, Math.round((lock.homeworkDone / lock.homeworkTotal) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
