import { supabase } from "@/integrations/supabase/client";
import { getSessionUserId } from "@/lib/auth/session";
import type { SubjectV } from "@/lib/taxonomy";

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
  student_id: string;
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

const THREAD_COLUMNS =
  "id, student_id, tutor_id, subject, spec_point_id, resource_id, mcq_set_id, subject_line, context_label, status, student_last_read_at, tutor_last_read_at, last_message_at, created_at";

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
    if (error) {
      console.error("Error loading chat threads:", error);
      return [];
    }
    const rows = (threads ?? []) as ChatThread[];
    if (rows.length === 0) return [];

    const [{ data: messages }, tutors] = await Promise.all([
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

    // A tutor's counterpart is the student, so their names come from profiles —
    // which tutors may read. A student's counterpart is the tutor, whose name
    // only the directory RPC will hand over.
    const studentNames = new Map<string, string>();
    const studentIds = [...new Set(rows.map((t) => t.student_id))].filter((id) => id !== uid);
    if (studentIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", studentIds);
      for (const p of profiles ?? []) {
        studentNames.set(p.id, p.display_name?.trim() || "Student");
      }
    }
    const tutorNames = new Map(tutors.map((t) => [t.id, t.display_name]));

    return rows.map((t) => {
      const mine = t.student_id === uid;
      const watermark = mine ? t.student_last_read_at : t.tutor_last_read_at;
      const threadMessages = (messages ?? []).filter((m) => m.thread_id === t.id);
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
          : studentNames.get(t.student_id) || "Student",
      };
    });
  }

  static async getMessages(threadId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, thread_id, sender_id, body, ai_drafted, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Error loading chat messages:", error);
      return [];
    }
    return (data ?? []) as ChatMessage[];
  }

  /**
   * Opens a thread and posts its first message, as the signed-in student.
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
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await ChatDAL.sendMessage({ threadId: data.id, body: input.body });
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

  /** Total unread across every thread — the sidebar badge. */
  static async unreadCount(): Promise<number> {
    const { data, error } = await supabase.rpc("chat_unread_count");
    if (error) {
      console.error("Error loading unread count:", error);
      return 0;
    }
    return Number(data ?? 0);
  }
}
