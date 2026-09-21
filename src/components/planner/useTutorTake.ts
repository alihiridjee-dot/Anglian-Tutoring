import { useQuery, useQueryClient } from "@tanstack/react-query";
import { plannerKey } from "@/lib/planner/queries";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { WeeklyPlanDAL, type WeeklyPlan } from "@/lib/planner/weeklyPlanDal";
import { PlannerRosterDAL, type SpecPointLabel } from "@/lib/planner/plannerRosterDal";
import { WeeklyNotesDAL } from "@/lib/planner/weeklyNotesDal";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { addWeeks, weekKeyToDate, toDateKey, weekRangeLabel } from "@/lib/planner/week";
import { draftWeeklyFeedback } from "@/lib/planner/weeklyFeedback.functions";

/** Per-point performance the tutor's AI draft is grounded in. */
export type FeedbackMetric = {
  code: string;
  title: string;
  topic: string | null;
  status: string;
  homeworkScore: number | null;
  quizScore: number | null;
};

/** The tutor's note on a week and the points lined up for the next one: load, draft, save, apply. */
export function useTutorTake({
  studentId,
  plan,
  subject,
  board,
  level,
  weekStart,
  onChanged,
  metrics,
  studentReflection,
  studentFeltReady,
}: {
  studentId: string;
  plan: WeeklyPlan;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  weekStart: string;
  onChanged: () => void;
  metrics: FeedbackMetric[];
  studentReflection: string | null;
  studentFeltReady: boolean | null;
}) {
  const nextStart = useMemo(() => toDateKey(addWeeks(weekKeyToDate(weekStart), 1)), [weekStart]);
  const nextLabel = weekRangeLabel(addWeeks(weekKeyToDate(weekStart), 1));
  const thisLabel = weekRangeLabel(weekKeyToDate(weekStart));

  const draftFn = useServerFn(draftWeeklyFeedback);
  const hasCheckin = studentFeltReady != null || !!studentReflection;

  const [note, setNote] = useState("");
  const [nextPoints, setNextPoints] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const noteKey = [...plannerKey(studentId), "tutor-note", plan.id, nextStart];
  const savedQuery = useQuery({
    queryKey: noteKey,
    queryFn: async () => {
      const [tn, next] = await Promise.all([
        WeeklyNotesDAL.getTutorNote(plan.id),
        WeeklyPlanDAL.getPlan(studentId, subject, nextStart),
      ]);
      return { tn, next };
    },
    refetchOnWindowFocus: false,
  });
  const loaded = savedQuery.isSuccess;
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "apply">(null);
  const [drafting, setDrafting] = useState(false);
  // Default to replying to the student when they've left a check-in.
  const [mode, setMode] = useState<"reply" | "general">("general");
  useEffect(() => {
    setMode(studentFeltReady != null || studentReflection ? "reply" : "general");
  }, [studentFeltReady, studentReflection]);

  // Labels for read-only display + the "next week will look like this" preview.

  // What's already sitting in next week's plan, so the preview is the full picture.
  const [existingNext, setExistingNext] = useState<SpecPointLabel[]>([]);

  const hydratedPlan = useRef<string | null>(null);
  useEffect(() => {
    if (!savedQuery.data || hydratedPlan.current === plan.id) return;
    hydratedPlan.current = plan.id;
    const { tn, next } = savedQuery.data;
    setNote(tn?.note ?? "");
    setSavedNote(tn?.note ?? null);
    setNextPoints(tn?.next_points ?? []);
    setExistingNext(
      (next?.points ?? []).map((p) => ({ id: p.spec_point_id, code: p.code, title: p.title })),
    );
  }, [plan.id, savedQuery.data]);
  const labelIds = [...new Set([...nextPoints, ...existingNext.map((p) => p.id)])].sort();
  const labelQuery = useQuery({
    queryKey: [...plannerKey(studentId), "point-labels", labelIds],
    queryFn: () => PlannerRosterDAL.getSpecPointLabels(labelIds),
    enabled: labelIds.length > 0,
  });

  // The resulting next-week focus = what's already there ∪ the tutor's new picks.
  const preview = useMemo(() => {
    const labels = new Map((labelQuery.data ?? []).map((r) => [r.id, r]));
    const existingIds = new Set(existingNext.map((p) => p.id));
    const merged = [...existingNext];
    for (const id of nextPoints) {
      if (!existingIds.has(id)) {
        const l = labels.get(id);
        merged.push({ id, code: l?.code ?? "…", title: l?.title ?? "" });
      }
    }
    return merged;
  }, [existingNext, nextPoints, labelQuery.data]);

  const saveTutorNote = async (input: Parameters<typeof WeeklyNotesDAL.saveTutorNote>[0]) => {
    await WeeklyNotesDAL.saveTutorNote(input);
    await queryClient.invalidateQueries({ queryKey: noteKey });
  };

  const draftWithAI = async () => {
    setDrafting(true);
    try {
      const res = await draftFn({
        data: {
          subject,
          board,
          level,
          weekLabel: thisLabel,
          mode,
          studentReflection,
          studentFeltReady,
          points: metrics,
        },
      });
      if (res?.feedback) {
        setNote(res.feedback);
        toast.success("Drafted — edit it, then save.");
      } else {
        toast.error("No draft came back — try again.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft that — try again.");
    } finally {
      setDrafting(false);
    }
  };

  const saveNote = async () => {
    setBusy("save");
    try {
      await saveTutorNote({
        planId: plan.id,
        studentId,
        note: note.trim() || null,
        nextPoints,
      });
      setSavedNote(note.trim() || null);
      toast.success("Saved your take.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setBusy(null);
    }
  };

  const applyToNextWeek = async () => {
    if (nextPoints.length === 0) {
      toast.info("Pick the spec points to line up for next week first.");
      return;
    }
    setBusy("apply");
    try {
      // Save the take, then merge the picks into next week's plan (creating it if
      // there isn't one yet) so the change is real, not just a suggestion.
      await saveTutorNote({
        planId: plan.id,
        studentId,
        note: note.trim() || null,
        nextPoints,
      });
      const existing = await WeeklyPlanDAL.getPlan(studentId, subject, nextStart);
      if (existing) {
        await WeeklyPlanDAL.addPoints(existing.plan.id, nextPoints, "tutor");
      } else {
        await WeeklyPlanDAL.savePlan({
          subject,
          board,
          level,
          weekStart: nextStart,
          specPointIds: nextPoints,
          source: "tutor",
          origin: "tutor",
          studentId,
        });
      }
      setSavedNote(note.trim() || null);
      const next = await WeeklyPlanDAL.getPlan(studentId, subject, nextStart);
      setExistingNext(
        (next?.points ?? []).map((p) => ({ id: p.spec_point_id, code: p.code, title: p.title })),
      );
      toast.success(`Lined up ${nextPoints.length} for ${nextLabel}.`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update next week — try again.");
    } finally {
      setBusy(null);
    }
  };

  return {
    loaded,
    nextLabel,
    thisLabel,
    hasCheckin,
    note,
    setNote,
    nextPoints,
    setNextPoints,
    savedNote,
    busy,
    drafting,
    mode,
    setMode,
    existingNext,
    preview,
    draftWithAI,
    saveNote,
    applyToNextWeek,
  };
}

export type TutorTakeState = ReturnType<typeof useTutorTake>;
