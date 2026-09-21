import { useQuery, useQueryClient } from "@tanstack/react-query";
import { plannerKey } from "@/lib/planner/queries";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type WeeklyPlan, type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { WeeklyNotesDAL } from "@/lib/planner/weeklyNotesDal";
import {
  statusOfPoint,
  summarize,
  laneOf,
  type PointCoverage,
  type Lane,
} from "@/lib/planner/coverage";
import { reviewLock } from "@/lib/planner/reviewLock";
import { type Activity } from "./useWeekPlan";

/** How the week went, read off the marks: overall, per lane, and whether the review may open yet. */
export function useWeekVerdicts({
  points,
  coverage,
  activity,
  weekStart,
}: {
  points: PlanPoint[];
  coverage: Map<string, PointCoverage>;
  activity: Activity;
  weekStart: string;
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

  return { summary, lanes, lock, metrics };
}

/** Which of the week's actions is in flight. Any one of them disables all three buttons. */
export type WeekReviewBusy = null | "confident" | "practice" | "carry";

/**
 * The student's weekly check-in: whether they feel ready, and their note to the
 * tutor. Loads what was saved, and saves both the verdict and the note.
 */
export function useWeeklyCheckin({
  studentId,
  plan,
  points,
  coverage,
  activity,
}: {
  studentId: string;
  plan: WeeklyPlan;
  points: PlanPoint[];
  coverage: Map<string, PointCoverage>;
  activity: Activity;
}) {
  const [coveredOk, setCoveredOk] = useState<boolean | null>(null);
  const [reflection, setReflection] = useState("");
  /** What the tutor can already see, so we only save when it actually changed. */
  const [sentReflection, setSentReflection] = useState("");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "sent">("idle");
  const checkinClient = useQueryClient();
  const checkinKey = [...plannerKey(studentId), "checkin", plan.id];
  const checkin = useQuery({
    queryKey: checkinKey,
    queryFn: () => WeeklyNotesDAL.getCheckin(plan.id),
    refetchOnWindowFocus: false,
  });
  const loaded = checkin.isSuccess;
  const [busy, setBusy] = useState<WeekReviewBusy>(null);

  const hydratedPlan = useRef<string | null>(null);
  useEffect(() => {
    if (!checkin.isSuccess || hydratedPlan.current === plan.id) return;
    hydratedPlan.current = plan.id;
    const c = checkin.data;
    setCoveredOk(c?.covered_ok ?? null);
    setReflection(c?.reflection ?? "");
    setSentReflection(c?.reflection ?? "");
    setNoteState(c?.reflection ? "sent" : "idle");
  }, [plan.id, checkin.data, checkin.isSuccess]);

  const saveCheckin = async (input: Parameters<typeof WeeklyNotesDAL.saveCheckin>[0]) => {
    await WeeklyNotesDAL.saveCheckin(input);
    await checkinClient.invalidateQueries({ queryKey: checkinKey });
  };

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
      await saveCheckin({
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
      await saveCheckin({
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

  return {
    coveredOk,
    reflection,
    setReflection,
    sentReflection,
    noteState,
    setNoteState,
    busy,
    setBusy,
    report,
    saveNote,
  };
}
