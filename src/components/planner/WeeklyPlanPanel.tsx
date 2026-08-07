import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  Wand2,
  Plus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Undo2,
} from "lucide-react";
import { WeeklyPlanDAL, type PlanPoint } from "@/lib/weeklyPlanDal";
import { interpretWeakness } from "@/lib/weeklyPlan.functions";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey, mondayOf, addWeeks, toDateKey, weekRangeLabel } from "@/lib/week";
import { carryOrigin } from "@/lib/planner/coverage";
import { ThisWeekPanel } from "./ThisWeekPanel";
import { useWeekPlan } from "./useWeekPlan";
import { WeekReview } from "./WeekReview";
import { subjectLabel } from "@/lib/courseSummary";

/**
 * The dashboard's "this week": subject tabs and week navigation around the
 * shared {@link ThisWeekPanel}, with the end-of-week review as its own box
 * underneath rather than buried at the bottom of the plan.
 *
 * The week itself needs no asking for — it's this week's slice of the year-long
 * programme and builds itself (see {@link useWeekPlan}). The student shapes it
 * by hand: drop a point, or describe what's tricky to pull more in.
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

  const [busy, setBusy] = useState(false);
  const [weakness, setWeakness] = useState("");
  const [showWeakness, setShowWeakness] = useState(false);
  const weaknessFn = useServerFn(interpretWeakness);

  const week = useWeekPlan({
    studentId,
    subject: (active?.subject ?? "biology") as SubjectV,
    board: (active?.board ?? "edexcel") as BoardV,
    level,
    weekStart,
    isCurrent,
    withCoverage: showReview,
  });

  const doWeakness = async () => {
    if (!active || !weakness.trim()) return;
    setBusy(true);
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
      if (week.plan) {
        await WeeklyPlanDAL.addPoints(week.plan.id, r.specPointIds, "student");
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
      await week.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add those — try again.");
    } finally {
      setBusy(false);
    }
  };

  // Pull a past-week point back into this week's plan, in the lane it was in —
  // the same rule the end-of-week carry follows ({@link carryOrigin}).
  const focusAgain = async (point: PlanPoint) => {
    if (!active) return;
    const curStart = currentWeekKey();
    const origin = carryOrigin(point.origin);
    try {
      const cur = await WeeklyPlanDAL.getPlan(studentId, active.subject as SubjectV, curStart);
      if (cur) {
        await WeeklyPlanDAL.addPoints(cur.plan.id, [point.spec_point_id], origin, {
          carriedFrom: weekStart,
        });
      } else {
        await WeeklyPlanDAL.savePlan({
          subject: active.subject as SubjectV,
          board: active.board as BoardV,
          level,
          weekStart: curStart,
          specPointIds: [point.spec_point_id],
          source: "student",
          origin,
          carriedFrom: weekStart,
        });
      }
      toast.success(`Added “${point.code}” back into this week.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add that back — try again.");
    }
  };

  if (!active) return null;

  return (
    <>
      <div className="rounded-2xl premium-card p-4 sm:p-5 shadow-sm mb-4">
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
                    {subjectLabel(e.subject)}
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

        {!week.loading && week.points.length === 0 && !week.roadmap ? (
          editable ? (
            <EmptyState onAddTricky={() => setShowWeakness(true)} future={isFuture} />
          ) : (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No plan was set for this week.
            </p>
          )
        ) : (
          <ThisWeekPanel
            plan={week.plan}
            points={week.points}
            activity={week.activity}
            coverage={week.coverage}
            roadmap={week.roadmap}
            loading={week.loading}
            weekStart={weekStart}
            editable={editable}
            isPast={isPast}
            showRationale={isCurrent}
            showCoverage={showReview}
            onRemove={week.removePoint}
            onFocusAgain={focusAgain}
            onAddTricky={editable ? () => setShowWeakness((s) => !s) : undefined}
          />
        )}

        {showWeakness && editable && (
          <WeaknessInput
            value={weakness}
            onChange={setWeakness}
            busy={busy}
            onSubmit={doWeakness}
          />
        )}
      </div>

      {/* The student's own read on the week — its own box, not a footnote to the plan. */}
      {showReview && week.plan && active && (
        <div className="mb-6">
          <WeekReview
            studentId={studentId}
            plan={week.plan}
            points={week.points}
            coverage={week.coverage}
            activity={week.activity}
            subject={active.subject as SubjectV}
            board={active.board as BoardV}
            level={level}
            weekStart={weekStart}
            onChanged={week.reload}
          />
        </div>
      )}
    </>
  );
}

/**
 * Shown when the week has nothing and the programme has nothing to give it —
 * which means the student hasn't rated anything yet, so it points them at the
 * board rather than at a button.
 */
function EmptyState({ onAddTricky, future }: { onAddTricky: () => void; future: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
        <Sparkles className="w-5 h-5" />
      </div>
      <p className="text-sm font-medium mb-1">
        {future ? "Nothing planned for this week yet" : "No plan for this week yet"}
      </p>
      <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
        {future
          ? "This week fills itself from your programme when it comes round. You can add something to it now if you want to get ahead."
          : "Sort a few topics on your planner and your week builds itself from them — weakest first, spread out to the exam."}
      </p>
      <button
        type="button"
        onClick={onAddTricky}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-border text-sm font-medium hover:bg-muted"
      >
        <Plus className="w-4 h-4" /> Add what's tricky
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
        className="mt-1.5 w-full rounded-lg premium-input px-3 py-2 text-sm resize-none"
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
