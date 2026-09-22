import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlanOverridesDAL } from "@/lib/planner/planOverridesDal";
import { ProgramDAL } from "@/lib/planner/programDal";
import { invalidatePlanner, type PlannerCourse } from "@/lib/planner/queries";
import { type PlanOverride } from "@/lib/planner/overrides";
import { currentWeekKey, weekKeyToDate, weekRangeLabel } from "@/lib/planner/week";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { type TutorWeekRow } from "./tutorWeekRows";

/** Which control is mid-flight, so the row can show it and the rest can wait. */
export type OverrideBusy =
  | { action: "remove" | "skip" | "move"; specPointId: string }
  | { action: "restore"; overrideId: string }
  | null;

const label = (week: string) => weekRangeLabel(weekKeyToDate(week));

/**
 * The tutor's executive controls over one student's week: remove, skip, move
 * and restore. Each is one call to the override DAL, a toast that says what
 * actually happened — the student's own work can keep a point in place — and
 * an invalidation so the week and the roadmap re-derive from the database.
 */
export function useTutorOverrides(params: {
  course: PlannerCourse;
  weekStart: string;
  /** The saved plan for the week in view, if any — its source says whether the programme cut it. */
  plan: { source: string } | null;
  studentName: string | null;
  onChanged: () => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState<OverrideBusy>(null);
  const { course, weekStart, studentName, onChanged } = params;
  const who = studentName ?? "The student";
  const settle = async () => {
    await invalidatePlanner(client, course.studentId);
    onChanged();
  };
  const fail = (e: unknown, fallback: string) =>
    toast.error(e instanceof Error ? e.message : fallback);

  const remove = async (row: TutorWeekRow) => {
    setBusy({ action: "remove", specPointId: row.specPointId });
    try {
      const result = await PlanOverridesDAL.remove({
        studentId: course.studentId,
        subject: course.subject,
        specPointId: row.specPointId,
        weekStart,
      });
      if (result.reason === "worked") {
        toast.info(`${who} has already worked on ${row.code} this week, so it stays.`);
      } else if (result.removed) {
        toast.success(
          row.pinned
            ? `Removed ${row.code} from ${label(weekStart)}.`
            : `Removed ${row.code} from ${label(weekStart)}. The programme won't put it back.`,
        );
      } else {
        toast.success(`${row.code} won't be set for ${label(weekStart)}.`);
      }
      await settle();
    } catch (e) {
      fail(e, "Couldn't remove that — try again.");
    } finally {
      setBusy(null);
    }
  };

  const skip = async (row: TutorWeekRow) => {
    setBusy({ action: "skip", specPointId: row.specPointId });
    try {
      const result = await PlanOverridesDAL.skip({
        studentId: course.studentId,
        subject: course.subject,
        specPointId: row.specPointId,
      });
      const cleared =
        result.removed > 0
          ? ` Cleared from ${result.removed} ${result.removed === 1 ? "week" : "weeks"}.`
          : "";
      const kept =
        result.pinnedWeeks.length > 0
          ? ` Still set by hand for ${result.pinnedWeeks.map(label).join(", ")}.`
          : "";
      const worked =
        result.workedWeeks.length > 0
          ? ` ${who} has worked on it in ${result.workedWeeks.map(label).join(", ")}, so it stays there.`
          : "";
      toast.success(
        `Skipped ${row.code} in ${subjectLabel(course.subject)}.${cleared}${kept}${worked}`,
      );
      await settle();
    } catch (e) {
      fail(e, "Couldn't skip that — try again.");
    } finally {
      setBusy(null);
    }
  };

  const move = async (row: TutorWeekRow, toWeek: string) => {
    setBusy({ action: "move", specPointId: row.specPointId });
    try {
      const result = await PlanOverridesDAL.move({
        ...course,
        specPointId: row.specPointId,
        fromWeek: weekStart,
        toWeek,
      });
      if (result.reason === "worked")
        toast.info(`${who} has already worked on ${row.code} this week, so it stays here.`);
      else toast.success(`Moved ${row.code} to ${label(toWeek)}.`);
      await settle();
    } catch (e) {
      fail(e, "Couldn't move that — try again.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Withdraw an override. A current week the programme has already cut is
   * re-cut so the point can come back now; a future week is cut when it
   * arrives, and a projected row simply reappears.
   */
  const restore = async (override: PlanOverride, code: string) => {
    setBusy({ action: "restore", overrideId: override.id });
    try {
      await PlanOverridesDAL.clear(override.id);
      const current = currentWeekKey();
      const recut =
        params.plan?.source === "ai" &&
        weekStart === current &&
        (override.kind === "skip" || override.weekStart === current);
      if (recut) await ProgramDAL.refreshWeek({ ...course, weekStart });
      toast.success(
        override.kind === "skip"
          ? `${code} is back in the programme.`
          : `${code} can be set for ${label(override.weekStart!)} again.`,
      );
      await settle();
    } catch (e) {
      fail(e, "Couldn't restore that — try again.");
    } finally {
      setBusy(null);
    }
  };

  return { busy, remove, skip, move, restore };
}

export type TutorOverrideActions = ReturnType<typeof useTutorOverrides>;
