import { supabase } from "@/integrations/supabase/client";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import { dbError } from "@/lib/platform/errors";
import type { PlanOverride } from "./overrides";
import { PlanOverridesDAL } from "./planOverridesDal";
import { plannerDateLabel, shortDayLabel, weekKeyToDate, weekRangeLabel } from "./week";

/**
 * One change someone made to a student's plan, as far as the database still
 * shows it. There is no change log: this is read back from what each change
 * left behind (see {@link changesFrom} for what that can and cannot show).
 */
export interface PlanChange {
  id: string;
  /** When, as a timestamp. */
  at: string;
  kind: "removed" | "moved" | "skipped" | "added" | "carried" | "break" | "break-cancelled";
  /** Whose hand it was. `null` when the rows don't say (a carried point). */
  actor: "tutor" | "student" | null;
  /** The member of staff, when the row names one. */
  by: string | null;
  specPointId?: string;
  /** The week it was in, or was put into (a Monday). For a break, its first Monday. */
  week?: string;
  /** A move: the week it went to. A break: its last day. A carry: the week it came from. */
  other?: string;
}

interface PlanRow {
  week_start: string;
  student_weekly_plan_points:
    | {
        spec_point_id: string;
        origin: string;
        created_at: string;
        carried_from: string | null;
      }[]
    | null;
}
interface BreakRow {
  id: string;
  starts_on: string;
  ends_on: string;
  booked_by: string | null;
  booked_at: string | null;
  cancelled_at: string | null;
}

/** The note the planner files when a removal is one half of a move. */
const MOVED_TO = /^Moved to the week of (\d{4}-\d{2}-\d{2})$/;
/** A move's two halves are saved moments apart. */
const SAME_ACT_MS = 5 * 60_000;

/**
 * The plan's changes, newest first, pieced together from three records:
 *
 * - **What a tutor set aside** (`student_plan_overrides`): a point removed from
 *   a week, moved to another, or skipped for good, with who and when.
 * - **What was put in by hand** (`student_weekly_plan_points`): a point a tutor
 *   or the student added, or one carried forward from an earlier week.
 * - **Breaks** (`student_breaks`): booked, and cancelled.
 *
 * What it cannot show, because nothing records it: a change that was later
 * undone (restoring a point deletes its record), a change of topic order or of
 * exam date, and which tutor added a point. A move is one removal and one
 * addition; the addition that belongs to a move is folded into it.
 */
export function changesFrom(p: {
  overrides: readonly PlanOverride[];
  plans: readonly PlanRow[];
  breaks: readonly BreakRow[];
}): PlanChange[] {
  const out: PlanChange[] = [];
  const moves: PlanChange[] = [];
  for (const o of p.overrides) {
    const to = o.kind === "remove" ? MOVED_TO.exec(o.note ?? "")?.[1] : undefined;
    const change: PlanChange = {
      id: `override:${o.id}`,
      at: o.createdAt,
      kind: o.kind === "skip" ? "skipped" : to ? "moved" : "removed",
      actor: "tutor",
      by: o.createdBy,
      specPointId: o.specPointId,
      week: o.weekStart ?? undefined,
      other: to,
    };
    out.push(change);
    if (to) moves.push(change);
  }
  const partOfMove = (specPointId: string, week: string, at: string) =>
    moves.some(
      (m) =>
        m.specPointId === specPointId &&
        m.other === week &&
        Math.abs(new Date(m.at).getTime() - new Date(at).getTime()) < SAME_ACT_MS,
    );
  for (const plan of p.plans)
    for (const point of plan.student_weekly_plan_points ?? []) {
      const byHand = point.origin === "tutor" || point.origin === "student";
      if (!byHand && !point.carried_from) continue;
      if (
        point.origin === "tutor" &&
        partOfMove(point.spec_point_id, plan.week_start, point.created_at)
      )
        continue;
      out.push({
        id: `point:${plan.week_start}:${point.spec_point_id}`,
        at: point.created_at,
        kind: point.carried_from ? "carried" : "added",
        actor: point.carried_from ? null : (point.origin as "tutor" | "student"),
        by: null,
        specPointId: point.spec_point_id,
        week: plan.week_start,
        other: point.carried_from ?? undefined,
      });
    }
  for (const b of p.breaks) {
    if (b.booked_at)
      out.push({
        id: `break:${b.id}`,
        at: b.booked_at,
        kind: "break",
        actor: null,
        by: b.booked_by,
        week: b.starts_on,
        other: b.ends_on,
      });
    if (b.cancelled_at)
      out.push({
        id: `break-cancelled:${b.id}`,
        at: b.cancelled_at,
        kind: "break-cancelled",
        actor: null,
        by: null,
        week: b.starts_on,
        other: b.ends_on,
      });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const weekOf = (key: string | undefined) => (key ? weekRangeLabel(weekKeyToDate(key)) : "a week");

/** A change in one sentence: who, what, and which weeks. */
export function describeChange(
  change: PlanChange,
  names: {
    /** A spec point's code and title, or null when the course no longer has it. */
    point: (id: string) => string | null;
    /** A member of staff's name, or null when they aren't in the directory. */
    staff: (id: string) => string | null;
    student: string;
  },
): string {
  const who =
    change.actor === "student"
      ? names.student
      : ((change.by && names.staff(change.by)) ?? (change.actor === "tutor" ? "A tutor" : null));
  const point = (change.specPointId && names.point(change.specPointId)) || "a spec point";
  const by = who ?? "Someone";
  switch (change.kind) {
    case "moved":
      return `${by} moved ${point} from ${weekOf(change.week)} to ${weekOf(change.other)}.`;
    case "removed":
      return `${by} removed ${point} from ${weekOf(change.week)}.`;
    case "skipped":
      return `${by} skipped ${point} for good.`;
    case "added":
      return `${by} added ${point} to ${weekOf(change.week)}.`;
    case "carried":
      return `${point} was carried from ${weekOf(change.other)} into ${weekOf(change.week)}.`;
    case "break":
      // A break's last day is a Sunday, so its dates are written day to day.
      return `${who ? `${who} booked a break` : "A break was booked"}: ${plannerDateLabel(
        weekKeyToDate(change.week ?? ""),
      )} – ${plannerDateLabel(weekKeyToDate(change.other ?? change.week ?? ""))}.`;
    case "break-cancelled":
      return `The break starting ${shortDayLabel(weekKeyToDate(change.week ?? ""))} was cancelled.`;
  }
}

export class PlanChangesDAL {
  /** The changes to one student's plan in one subject (breaks are the student's, whatever the subject). */
  static async list(studentId: string, subject: SubjectV): Promise<PlanChange[]> {
    const [overrides, plans, breaks] = await Promise.all([
      PlanOverridesDAL.list(studentId, subject),
      supabase
        .from("student_weekly_plans")
        .select(
          "week_start, student_weekly_plan_points(spec_point_id, origin, created_at, carried_from)",
        )
        .eq("student_id", studentId)
        .eq("subject", subject)
        .order("week_start", { ascending: false })
        .limit(80),
      supabase
        .from("student_breaks")
        .select("id, starts_on, ends_on, booked_by, booked_at, cancelled_at")
        .eq("student_id", studentId),
    ]);
    if (plans.error) throw dbError(plans.error);
    if (breaks.error) throw dbError(breaks.error);
    return changesFrom({
      overrides,
      plans: (plans.data ?? []) as unknown as PlanRow[],
      breaks: (breaks.data ?? []) as BreakRow[],
    });
  }
}
