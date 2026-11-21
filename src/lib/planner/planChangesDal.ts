import { supabase } from "@/integrations/supabase/client";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import { dbError } from "@/lib/platform/errors";
import type { PlanOverride } from "./overrides";
import { PlanOverridesDAL } from "./planOverridesDal";
import { plannerDateLabel, shortDayLabel, weekKeyToDate, weekRangeLabel } from "./week";

/**
 * One change someone made to a student's plan.
 *
 * Since 21 Nov 2026 the database logs each one as it is made
 * (`student_plan_changes`, migration 20261121124500). Changes older than the
 * log are read back from what they left behind ({@link changesFrom}), which
 * cannot show one that was later undone, a new topic order or a new exam date.
 */
export interface PlanChange {
  id: string;
  /** When, as a timestamp. */
  at: string;
  kind:
    | "removed"
    | "moved"
    | "skipped"
    | "restored"
    | "unskipped"
    | "added"
    | "carried"
    | "plan-started"
    | "exam-date"
    | "topic-order"
    | "break"
    | "break-cancelled"
    | "break-ended";
  /** Whose hand it was. `null` for the planner itself, or when nothing says. */
  actor: "tutor" | "student" | null;
  /** The member of staff, when the change names one. */
  by: string | null;
  specPointId?: string;
  /** The week it was in, or was put into (a Monday). For a break, its first Monday. */
  week?: string;
  /** A move: the week it went to. A break: its last day. A carry: the week it came from. */
  other?: string;
  /** An exam date: what it was, and what it became. */
  from?: string;
  to?: string;
  /** A topic order: the topics' titles as they ran, and as they run now. */
  before?: string[];
  after?: string[];
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
/** A row of the log, as the database writes it. */
export interface LogRow {
  id: string;
  kind: string;
  actor_id: string | null;
  actor_role: string;
  spec_point_id: string | null;
  week_start: string | null;
  detail: unknown;
  created_at: string;
}

/** The note the planner files when a removal is one half of a move. */
const MOVED_TO = /^Moved to the week of (\d{4}-\d{2}-\d{2})$/;
/** A move's two halves are saved moments apart. */
const SAME_ACT_MS = 5 * 60_000;
const LOG_KINDS: Record<string, PlanChange["kind"]> = {
  removed: "removed",
  moved: "moved",
  skipped: "skipped",
  restored: "restored",
  unskipped: "unskipped",
  added: "added",
  carried: "carried",
  "plan-started": "plan-started",
  "exam-date": "exam-date",
  "topic-order": "topic-order",
  "break-booked": "break",
  "break-cancelled": "break-cancelled",
  "break-ended": "break-ended",
};

const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const titles = (v: unknown) =>
  Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : undefined;

/** The log's rows as changes. A kind this version doesn't know is left out, not guessed at. */
export function changesFromLog(rows: readonly LogRow[]): PlanChange[] {
  const out: PlanChange[] = [];
  for (const row of rows) {
    const kind = LOG_KINDS[row.kind];
    if (!kind) continue;
    const detail = (row.detail && typeof row.detail === "object" ? row.detail : {}) as Record<
      string,
      unknown
    >;
    out.push({
      id: `log:${row.id}`,
      at: row.created_at,
      kind,
      actor: row.actor_role === "tutor" || row.actor_role === "student" ? row.actor_role : null,
      by: row.actor_role === "tutor" ? row.actor_id : null,
      specPointId: row.spec_point_id ?? undefined,
      week: row.week_start ?? undefined,
      other: text(detail.to_week) ?? text(detail.from_week) ?? text(detail.ends_on),
      from: text(detail.from),
      to: text(detail.to),
      before: titles(detail.before),
      after: titles(detail.after),
    });
  }
  return out;
}

/**
 * A move is one removal and one addition, saved moments apart. The addition
 * that belongs to a move is folded into it, so a move reads as one change.
 */
export function foldMoves(changes: readonly PlanChange[]): PlanChange[] {
  const moves = changes.filter((c) => c.kind === "moved" && c.other);
  return changes.filter(
    (c) =>
      !(
        c.kind === "added" &&
        c.actor === "tutor" &&
        moves.some(
          (m) =>
            m.specPointId === c.specPointId &&
            m.other === c.week &&
            Math.abs(new Date(m.at).getTime() - new Date(c.at).getTime()) < SAME_ACT_MS,
        )
      ),
  );
}

/**
 * Changes from before the log, newest first, pieced together from three records:
 *
 * - **What a tutor set aside** (`student_plan_overrides`): a point removed from
 *   a week, moved to another, or skipped for good, with who and when.
 * - **What was put in by hand** (`student_weekly_plan_points`): a point a tutor
 *   or the student added, or one carried forward from an earlier week.
 * - **Breaks** (`student_breaks`): booked, and cancelled.
 *
 * It cannot show a change that was later undone (restoring a point deletes its
 * record), a change of topic order or of exam date, or which tutor added a point.
 */
export function changesFrom(p: {
  overrides: readonly PlanOverride[];
  plans: readonly PlanRow[];
  breaks: readonly BreakRow[];
}): PlanChange[] {
  const out: PlanChange[] = [];
  for (const o of p.overrides) {
    const to = o.kind === "remove" ? MOVED_TO.exec(o.note ?? "")?.[1] : undefined;
    out.push({
      id: `override:${o.id}`,
      at: o.createdAt,
      kind: o.kind === "skip" ? "skipped" : to ? "moved" : "removed",
      actor: "tutor",
      by: o.createdBy,
      specPointId: o.specPointId,
      week: o.weekStart ?? undefined,
      other: to,
    });
  }
  for (const plan of p.plans)
    for (const point of plan.student_weekly_plan_points ?? []) {
      const byHand = point.origin === "tutor" || point.origin === "student";
      if (!byHand && !point.carried_from) continue;
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
  return foldMoves(out).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The whole history, newest first: the log from the day it began, and before
 * that what the older rows still show. A pieced-together change from after the
 * log began is the log's own change seen a second way, so it is left out.
 */
export function mergeChanges(
  log: readonly PlanChange[],
  older: readonly PlanChange[],
): PlanChange[] {
  const began = log.reduce<string | null>(
    (min, c) => (min === null || c.at < min ? c.at : min),
    null,
  );
  return [...foldMoves(log), ...older.filter((c) => began === null || c.at < began)].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
}

const weekOf = (key: string | undefined) => (key ? weekRangeLabel(weekKeyToDate(key)) : "a week");
const dayOf = (key: string | undefined) =>
  key
    ? plannerDateLabel(weekKeyToDate(key), { day: "numeric", month: "short", year: "numeric" })
    : "another date";

/** The one topic whose move explains a new order, and which way it went; null when more than one moved. */
function movedTopic(before: string[], after: string[]): { title: string; later: boolean } | null {
  if (before.length !== after.length) return null;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);
  for (const title of before) {
    const without = (list: string[]) => list.filter((t) => t !== title);
    if (before.indexOf(title) !== after.indexOf(title) && same(without(before), without(after)))
      return { title, later: after.indexOf(title) > before.indexOf(title) };
  }
  return null;
}

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
  // A change with nobody's name on it was the planner's own (a nightly job).
  const orPlanner = who ?? "The planner";
  switch (change.kind) {
    case "moved":
      return `${by} moved ${point} from ${weekOf(change.week)} to ${weekOf(change.other)}.`;
    case "removed":
      return `${by} removed ${point} from ${weekOf(change.week)}.`;
    case "restored":
      return `${by} put ${point} back into ${weekOf(change.week)}.`;
    case "skipped":
      return `${by} skipped ${point} for good.`;
    case "unskipped":
      return `${by} brought ${point} back into the programme.`;
    case "added":
      return `${by} added ${point} to ${weekOf(change.week)}.`;
    case "carried":
      return `${point} was carried from ${weekOf(change.other)} into ${weekOf(change.week)}.`;
    case "plan-started":
      return `The plan started, from the week of ${weekOf(change.week)}.`;
    case "exam-date":
      return `${orPlanner} changed the exam date from ${dayOf(change.from)} to ${dayOf(change.to)}.`;
    case "topic-order": {
      const one = change.before && change.after ? movedTopic(change.before, change.after) : null;
      return one
        ? `${orPlanner} moved ${one.title} ${one.later ? "later" : "earlier"} in the topic order.`
        : `${orPlanner} changed the topic order.`;
    }
    case "break":
      // A break's last day is a Sunday, so its dates are written day to day.
      return `${who ? `${who} booked a break` : "A break was booked"}: ${plannerDateLabel(
        weekKeyToDate(change.week ?? ""),
      )} – ${plannerDateLabel(weekKeyToDate(change.other ?? change.week ?? ""))}.`;
    case "break-cancelled":
      return `The break starting ${shortDayLabel(weekKeyToDate(change.week ?? ""))} was cancelled.`;
    case "break-ended":
      return `The break starting ${shortDayLabel(weekKeyToDate(change.week ?? ""))} ended early.`;
  }
}

/** The log table isn't there: the migration has not been applied to this database. */
const noLog = (error: { code?: string; message?: string }) =>
  error.code === "PGRST205" ||
  error.code === "42P01" ||
  /student_plan_changes/.test(error.message ?? "");

export class PlanChangesDAL {
  /** The changes to one student's plan in one subject (breaks are the student's, whatever the subject). */
  static async list(studentId: string, subject: SubjectV): Promise<PlanChange[]> {
    const [log, overrides, plans, breaks] = await Promise.all([
      supabase
        .from("student_plan_changes")
        .select("id, kind, actor_id, actor_role, spec_point_id, week_start, detail, created_at")
        .eq("student_id", studentId)
        .or(`subject.eq.${subject},subject.is.null`)
        .order("created_at", { ascending: false })
        .limit(300),
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
    // Without the log the tab still shows what the older rows hold.
    if (log.error && !noLog(log.error)) throw dbError(log.error);
    if (plans.error) throw dbError(plans.error);
    if (breaks.error) throw dbError(breaks.error);
    return mergeChanges(
      changesFromLog((log.data ?? []) as LogRow[]),
      changesFrom({
        overrides,
        plans: (plans.data ?? []) as unknown as PlanRow[],
        breaks: (breaks.data ?? []) as BreakRow[],
      }),
    );
  }
}
