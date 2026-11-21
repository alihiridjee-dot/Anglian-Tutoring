import { PlanOverridesDAL } from "@/lib/planner/planOverridesDal";
import type { PlannerCourse } from "@/lib/planner/queries";

/** A ticked line, as far as an action on it needs to know. */
export interface BulkLine {
  specPointId: string;
  code: string;
  /** The Monday of the week the line sits in. */
  week: string;
}

/**
 * What became of the ticked lines. A line the student has already worked on
 * stays where it is (the database's rule, not a failure), and a line that
 * could not be changed says why in the database's own words.
 */
export interface BulkOutcome {
  /** Codes that were changed. */
  done: string[];
  /** Codes left alone because the student has already worked on them. */
  worked: string[];
  failed: { code: string; reason: string }[];
}

const reasonOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "It didn't save.");

/**
 * The tutor's row actions, over several lines at once and across weeks.
 *
 * The row menu's own hook acts on one line in the one week in view. The
 * workbench ticks lines in any week, so these call the same database rules
 * directly, one line at a time and in order: there is no bulk rule to call, and
 * a move is itself two steps (out of one week, into another). One line failing
 * never stops the rest, and the caller tells the tutor once, at the end.
 */
export const BulkActions = {
  /** Take each line out of its own week. The programme won't put it back there. */
  async remove(course: PlannerCourse, lines: BulkLine[]): Promise<BulkOutcome> {
    const out: BulkOutcome = { done: [], worked: [], failed: [] };
    for (const line of lines) {
      try {
        const result = await PlanOverridesDAL.remove({
          studentId: course.studentId,
          subject: course.subject,
          specPointId: line.specPointId,
          weekStart: line.week,
        });
        (result.reason === "worked" ? out.worked : out.done).push(line.code);
      } catch (e) {
        out.failed.push({ code: line.code, reason: reasonOf(e) });
      }
    }
    return out;
  },

  /** Move each line to one week. A line already in that week is left where it is. */
  async move(course: PlannerCourse, lines: BulkLine[], toWeek: string): Promise<BulkOutcome> {
    const out: BulkOutcome = { done: [], worked: [], failed: [] };
    for (const line of lines) {
      if (line.week === toWeek) continue;
      try {
        const result = await PlanOverridesDAL.move({
          ...course,
          specPointId: line.specPointId,
          fromWeek: line.week,
          toWeek,
        });
        (result.reason === "worked" ? out.worked : out.done).push(line.code);
      } catch (e) {
        out.failed.push({ code: line.code, reason: reasonOf(e) });
      }
    }
    return out;
  },

  /** Skip each point in the programme for good: once per point, whichever weeks it was ticked in. */
  async skip(course: PlannerCourse, lines: BulkLine[]): Promise<BulkOutcome> {
    const out: BulkOutcome = { done: [], worked: [], failed: [] };
    const seen = new Set<string>();
    for (const line of lines) {
      if (seen.has(line.specPointId)) continue;
      seen.add(line.specPointId);
      try {
        const result = await PlanOverridesDAL.skip({
          studentId: course.studentId,
          subject: course.subject,
          specPointId: line.specPointId,
        });
        // Skipped either way; a week they have worked on it in keeps it.
        (result.workedWeeks.length ? out.worked : out.done).push(line.code);
      } catch (e) {
        out.failed.push({ code: line.code, reason: reasonOf(e) });
      }
    }
    return out;
  },
};

const list = (codes: string[]) =>
  codes.length <= 3
    ? codes.join(", ")
    : `${codes.slice(0, 3).join(", ")} and ${codes.length - 3} more`;

/**
 * The outcome in words, for one message: what changed, what stayed because the
 * student has worked on it, and what failed with the first reason given.
 */
export function describeOutcome(
  verb: "Removed" | "Moved" | "Skipped",
  outcome: BulkOutcome,
  who: string,
  where?: string,
): { ok: boolean; text: string } {
  const parts: string[] = [];
  if (outcome.done.length) parts.push(`${verb} ${list(outcome.done)}${where ? ` ${where}` : ""}.`);
  if (outcome.worked.length)
    parts.push(
      verb === "Skipped"
        ? `Skipped ${list(outcome.worked)} too; the weeks ${who} has worked on them in keep them.`
        : `${who} has already worked on ${list(outcome.worked)}, so ${outcome.worked.length === 1 ? "it stays" : "they stay"}.`,
    );
  if (outcome.failed.length)
    parts.push(
      `Couldn't change ${list(outcome.failed.map((f) => f.code))}: ${outcome.failed[0].reason}`,
    );
  if (parts.length === 0) parts.push("Nothing to change.");
  return { ok: outcome.failed.length === 0, text: parts.join(" ") };
}
