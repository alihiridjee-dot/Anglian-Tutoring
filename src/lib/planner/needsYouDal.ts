import { supabase } from "@/integrations/supabase/client";
import { ChatDAL } from "@/lib/chat/chatDal";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import { dbError } from "@/lib/platform/errors";
import { StudentsDAL, type StudentThread } from "@/lib/students/studentsDal";
import { WeeklyNotesDAL } from "./weeklyNotesDal";
import { addWeeks, currentWeekKey, toDateKey, weekKeyToDate } from "./week";

/** How far back an unanswered check-in still asks for an answer. */
const CHECKIN_WEEKS = 4;

/**
 * Something one student has sent that no tutor has dealt with yet: a weekly
 * check-in, or a message (theirs, or a parent's about them).
 */
export interface NeedItem {
  /** `checkin:<plan id>` or `thread:<thread id>`. */
  id: string;
  kind: "checkin" | "message" | "parent";
  /** When it was sent, as a timestamp. */
  at: string;
  text: string;
  /** A check-in: the week's plan it belongs to. */
  planId?: string;
  weekStart?: string;
  /** A message: its thread, and what the thread is called. */
  threadId?: string;
  subjectLine?: string;
}

interface CheckinRow {
  plan_id: string;
  covered_ok: boolean | null;
  reflection: string | null;
  created_at: string;
}
interface PlanRow {
  id: string;
  subject: string;
  week_start: string;
}
interface SummaryRow {
  thread_id: string;
  unread: number;
  last_message: string | null;
}

/** A check-in in words: how the week felt, then what they wrote. */
function checkinText(row: CheckinRow): string {
  const felt =
    row.covered_ok === false
      ? "Wanted more practice."
      : row.covered_ok
        ? "Felt confident to move on."
        : "";
  const wrote = row.reflection?.trim() ? `“${row.reflection.trim()}”` : "";
  return [felt, wrote].filter(Boolean).join(" ");
}

/**
 * What still needs a tutor, newest first.
 *
 * A check-in counts when the student said something a tutor would answer (they
 * wanted more practice, or they wrote a line), it is for this subject and a
 * recent week, and no tutor's note has been filed against that week. A thread
 * counts while it holds messages no tutor has read. Read is the nearest the
 * data comes to answered: the threads keep one read mark for all tutors and do
 * not record who spoke last.
 */
export function needsFrom(p: {
  subject: SubjectV;
  /** The earliest week a check-in still counts from. */
  since: string;
  checkins: CheckinRow[];
  plans: PlanRow[];
  /** Plans a tutor's note has been filed against, with or without words. */
  answered: Set<string>;
  threads: StudentThread[];
  summaries: SummaryRow[];
}): NeedItem[] {
  const plans = new Map(p.plans.map((plan) => [plan.id, plan]));
  const out: NeedItem[] = [];
  for (const row of p.checkins) {
    const plan = plans.get(row.plan_id);
    if (!plan || plan.subject !== p.subject || plan.week_start < p.since) continue;
    if (p.answered.has(row.plan_id)) continue;
    if (row.covered_ok !== false && !row.reflection?.trim()) continue;
    out.push({
      id: `checkin:${row.plan_id}`,
      kind: "checkin",
      at: row.created_at,
      text: checkinText(row),
      planId: row.plan_id,
      weekStart: plan.week_start,
    });
  }
  const summaries = new Map(p.summaries.map((s) => [s.thread_id, s]));
  for (const thread of p.threads) {
    const summary = summaries.get(thread.id);
    if (!summary || summary.unread <= 0) continue;
    out.push({
      id: `thread:${thread.id}`,
      kind: thread.about_student_id ? "parent" : "message",
      at: thread.last_message_at,
      text: summary.last_message?.trim() || thread.subject_line,
      threadId: thread.id,
      subjectLine: thread.subject_line,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The tutor's "Needs you" list for one student, and the two ways to deal with
 * an item: answer it, or say it needs no answer.
 */
export class NeedsYouDAL {
  static async list(studentId: string, subject: SubjectV): Promise<NeedItem[]> {
    const since = toDateKey(addWeeks(weekKeyToDate(currentWeekKey()), -CHECKIN_WEEKS));
    const [checkinResult, threads] = await Promise.all([
      supabase
        .from("student_weekly_checkins")
        .select("plan_id, covered_ok, reflection, created_at")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(20),
      StudentsDAL.listThreads(studentId),
    ]);
    if (checkinResult.error) throw dbError(checkinResult.error);
    const checkins = (checkinResult.data ?? []) as CheckinRow[];
    const planIds = [...new Set(checkins.map((c) => c.plan_id))];
    const threadIds = threads.map((t) => t.id);
    const [planResult, notes, summaryResult] = await Promise.all([
      planIds.length
        ? supabase.from("student_weekly_plans").select("id, subject, week_start").in("id", planIds)
        : Promise.resolve({ data: [], error: null }),
      WeeklyNotesDAL.getTutorNotes(planIds),
      threadIds.length
        ? supabase.rpc("chat_thread_summaries", { p_thread_ids: threadIds })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (planResult.error) throw dbError(planResult.error);
    if (summaryResult.error) throw dbError(summaryResult.error);
    return needsFrom({
      subject,
      since,
      checkins,
      plans: (planResult.data ?? []) as PlanRow[],
      answered: new Set(notes.keys()),
      threads,
      summaries: (summaryResult.data ?? []) as SummaryRow[],
    });
  }

  /**
   * Answer an item. A check-in's answer is the tutor's note on that week, which
   * the student reads on their planner; the points already lined up for their
   * next week are kept. A message's answer goes into its thread.
   */
  static async reply(studentId: string, item: NeedItem, words: string): Promise<void> {
    const body = words.trim();
    if (!body) throw new Error("Write a reply first.");
    if (item.planId) await this.fileNote(studentId, item.planId, body);
    else if (item.threadId) {
      await ChatDAL.sendMessage({ threadId: item.threadId, body });
      await ChatDAL.markRead(item.threadId);
    }
  }

  /**
   * Deal with an item without answering it. A thread is marked read. A check-in
   * gets an empty note filed against its week, which the student is not shown,
   * so it stops asking.
   */
  static async settle(studentId: string, item: NeedItem): Promise<void> {
    if (item.planId) await this.fileNote(studentId, item.planId, null);
    else if (item.threadId) await ChatDAL.markRead(item.threadId);
  }

  private static async fileNote(studentId: string, planId: string, note: string | null) {
    const existing = await WeeklyNotesDAL.getTutorNote(planId);
    await WeeklyNotesDAL.saveTutorNote({
      planId,
      studentId,
      // Never over a note a tutor has already written.
      note: existing?.note?.trim() ? existing.note : note,
      nextPoints: existing?.next_points ?? [],
    });
  }
}
