import { supabase } from "@/integrations/supabase/client";
import { getSessionUserId } from "@/lib/auth/session";
import type { SubjectV } from "@/lib/curriculum/taxonomy";

/**
 * Data Access Layer for student ↔ tutor messaging.
 *
 * Every read here is scoped by RLS, not by the arguments: a student sees their
 * own threads because the policy says so, and a tutor sees all of them for the
 * same reason. Nothing in this file filters by identity, which is what stops the
 * two views from drifting apart or from being widened by a client bug.
 *
 * Read state and the tutor directory go through RPCs — which watermark to write,
 * and which accounts count as staff, are rules that belong in one place.
 */

/** What a thread is pinned to. Derived from whichever FK the row carries. */
export type ChatContextKind = "spec_point" | "homework" | "mcq_set" | "general";

export interface ChatThread {
  id: string;
  /** The thread's one non-staff member: a student, or a parent. */
  student_id: string;
  /** Set when that member is a parent: the child the conversation is about. */
  about_student_id: string | null;
  tutor_id: string | null;
  subject: string | null;
  spec_point_id: string | null;
  resource_id: string | null;
  mcq_set_id: string | null;
  subject_line: string;
  context_label: string | null;
  status: string;
  student_last_read_at: string | null;
  tutor_last_read_at: string | null;
  last_message_at: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  ai_drafted: boolean;
  created_at: string;
}

export interface TutorOption {
  id: string;
  display_name: string;
}

/** A thread plus the bits the list needs that don't live on the row. */
export interface ThreadSummary extends ChatThread {
  contextKind: ChatContextKind;
  /** Messages addressed to the viewer that they haven't opened yet. */
  unread: number;
  lastMessage: string | null;
  /** Who the thread is with, from the viewer's side. */
  counterpartName: string;
}

/**
 * The name a tutor sees for a thread's member. A parent is named with the
 * child the conversation is about, because "Mum" alone doesn't say whose.
 */
export function memberLabel(
  t: Pick<ChatThread, "student_id" | "about_student_id">,
  names: ReadonlyMap<string, string>,
): string {
  const member = names.get(t.student_id);
  if (!t.about_student_id) return member || "Student";
  const child = names.get(t.about_student_id);
  return `${member || "Parent"} · parent of ${child || "a student"}`;
}

const THREAD_COLUMNS =
  "id, student_id, about_student_id, tutor_id, subject, spec_point_id, resource_id, mcq_set_id, subject_line, context_label, status, student_last_read_at, tutor_last_read_at, last_message_at, created_at";

export function contextKindOf(t: ChatThread): ChatContextKind {
  if (t.spec_point_id) return "spec_point";
  if (t.resource_id) return "homework";
  if (t.mcq_set_id) return "mcq_set";
  return "general";
}

/**
 * Where "open what this is about" should take you, as a router target rather
 * than a formatted path — the quiz route is dynamic (`/mcq/$setId`), and
 * TanStack Router wants the pattern plus params, not an interpolated string.
 * Null for a general question, which has nothing to open.
 */
export type ContextTarget =
  { to: "/curriculum" } | { to: "/homework" } | { to: "/mcq/$setId"; params: { setId: string } };

export function contextTarget(t: ChatThread): ContextTarget | null {
  if (t.spec_point_id) return { to: "/curriculum" };
  if (t.resource_id) return { to: "/homework" };
  if (t.mcq_set_id) return { to: "/mcq/$setId", params: { setId: t.mcq_set_id } };
  return null;
}

export class ChatDAL {
  /** Tutors a student may address a question to, by name. */
  static async listTutors(): Promise<TutorOption[]> {
    const { data, error } = await supabase.rpc("tutor_directory");
    if (error) {
      console.error("Error loading tutor directory:", error);
      return [];
    }
    return (data ?? []) as TutorOption[];
  }

  /**
   * Every thread the caller can see, newest activity first, with the unread
   * count and last line each row needs.
   *
   * The counts are computed here from one extra query rather than per row, so
   * an inbox of fifty threads is still two round trips.
   */
  static async listThreads(): Promise<ThreadSummary[]> {
    const uid = await getSessionUserId();
    if (!uid) return [];

    const { data: threads, error } = await supabase
      .from("chat_threads")
      .select(THREAD_COLUMNS)
      .order("last_message_at", { ascending: false });
    // Thrown, not turned into []. These reads are polled every twenty seconds,
    // and React Query keeps the last good data when a refetch *fails* — but an
    // empty array is a success, so one dropped poll used to replace a full
    // inbox with "No conversations yet" until the next one came round.
    if (error) throw new Error(error.message);
    const rows = (threads ?? []) as ChatThread[];
    if (rows.length === 0) return [];

    const [{ data: messages, error: messagesError }, tutors] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("thread_id, sender_id, body, created_at")
        .in(
          "thread_id",
          rows.map((t) => t.id),
        )
        .order("created_at", { ascending: true }),
      ChatDAL.listTutors(),
    ]);
    // Without the messages every thread would report nothing unread and no
    // last line — a quiet wrong answer rather than a visible failure.
    if (messagesError) throw new Error(messagesError.message);

    // A tutor's counterpart is the student (or a parent, and the child they're
    // writing about), so their names come from profiles — which tutors may
    // read. A student's or parent's counterpart is the tutor, whose name only
    // the directory RPC will hand over.
    const memberNames = new Map<string, string>();
    const memberIds = [
      ...new Set(
        rows
          .filter((t) => t.student_id !== uid)
          .flatMap((t) =>
            t.about_student_id ? [t.student_id, t.about_student_id] : [t.student_id],
          ),
      ),
    ];
    if (memberIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", memberIds);
      for (const p of profiles ?? []) {
        const name = p.display_name?.trim();
        if (name) memberNames.set(p.id, name);
      }
    }
    const tutorNames = new Map(tutors.map((t) => [t.id, t.display_name]));

    // Bucket the messages by thread once. Re-filtering the whole array inside the
    // map below made this O(threads × messages) — fine for a student with three
    // conversations, quadratic for a tutor working an inbox, which is the only
    // person who ever sees the big version of this list.
    const byThread = new Map<string, typeof messages>();
    for (const m of messages ?? []) {
      const bucket = byThread.get(m.thread_id);
      if (bucket) bucket.push(m);
      else byThread.set(m.thread_id, [m]);
    }

    return rows.map((t) => {
      const mine = t.student_id === uid;
      const watermark = mine ? t.student_last_read_at : t.tutor_last_read_at;
      const threadMessages = byThread.get(t.id) ?? [];
      const unread = threadMessages.filter(
        (m) => m.sender_id !== uid && (!watermark || m.created_at > watermark),
      ).length;

      return {
        ...t,
        contextKind: contextKindOf(t),
        unread,
        lastMessage: threadMessages.at(-1)?.body ?? null,
        counterpartName: mine
          ? (t.tutor_id && tutorNames.get(t.tutor_id)) || "Your tutor"
          : memberLabel(t, memberNames),
      };
    });
  }

  static async getMessages(threadId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, thread_id, sender_id, body, ai_drafted, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    // As above: [] here blanked the conversation someone was in the middle of
    // reading, and brought it back twenty seconds later.
    if (error) throw new Error(error.message);
    return (data ?? []) as ChatMessage[];
  }

  /**
   * Opens a thread and posts its first message, as the signed-in student — or
   * as a parent, who names the linked child it is about (`aboutStudentId`).
   *
   * The two writes are separate statements, so a failure between them would
   * leave an empty thread. That is the harmless direction — an empty thread is
   * visible and can be replied to, whereas a message with no thread is
   * unreachable — and the FK makes the reverse impossible anyway.
   */
  static async startThread(input: {
    tutorId: string;
    subjectLine: string;
    body: string;
    /** Narrowed to the subject enum — it is the column's own type. */
    subject?: SubjectV | null;
    specPointId?: string | null;
    resourceId?: string | null;
    mcqSetId?: string | null;
    contextLabel?: string | null;
    aboutStudentId?: string | null;
  }): Promise<string> {
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");

    const { data, error } = await supabase
      .from("chat_threads")
      .insert({
        student_id: uid,
        tutor_id: input.tutorId,
        subject_line: input.subjectLine.trim(),
        subject: input.subject ?? null,
        spec_point_id: input.specPointId ?? null,
        resource_id: input.resourceId ?? null,
        mcq_set_id: input.mcqSetId ?? null,
        context_label: input.contextLabel ?? null,
        about_student_id: input.aboutStudentId ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    try {
      await ChatDAL.sendMessage({ threadId: data.id, body: input.body });
    } catch (err) {
      // The student is about to press Send again, and that makes another
      // thread. Left in place, each failed attempt stacked one more empty
      // conversation in both inboxes. Best-effort: if this fails too, an empty
      // thread is still the harmless direction.
      await supabase.rpc("delete_chat_thread", { p_thread_id: data.id }).then(
        () => undefined,
        () => undefined,
      );
      throw err;
    }
    return data.id;
  }

  /** Posts a reply. The database trigger bumps the thread and notifies. */
  static async sendMessage(input: {
    threadId: string;
    body: string;
    aiDrafted?: boolean;
  }): Promise<void> {
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");

    const { error } = await supabase.from("chat_messages").insert({
      thread_id: input.threadId,
      sender_id: uid,
      body: input.body.trim(),
      ai_drafted: input.aiDrafted ?? false,
    });
    if (error) throw new Error(error.message);
  }

  /** Marks the caller's own side of a thread read. */
  static async markRead(threadId: string): Promise<void> {
    const { error } = await supabase.rpc("mark_chat_thread_read", { p_thread_id: threadId });
    if (error) console.error("Error marking thread read:", error);
  }

  /** Permanently deletes a thread, its messages and their notifications. */
  static async deleteThread(threadId: string): Promise<void> {
    const { error } = await supabase.rpc("delete_chat_thread", { p_thread_id: threadId });
    if (error) throw new Error(error.message);
  }

  /** Total unread across every thread — the sidebar badge. */
  static async unreadCount(): Promise<number> {
    const { data, error } = await supabase.rpc("chat_unread_count");
    // Thrown so a failed poll keeps the last count, instead of clearing the
    // badge off a message that is still waiting.
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }
}
