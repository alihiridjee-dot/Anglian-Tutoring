import { supabase } from "@/integrations/supabase/client";
import { getSessionUserId } from "@/lib/auth/session";
import type { Database } from "@/integrations/supabase/types";
import type { BoardV, LevelV, SubjectV } from "@/lib/curriculum/taxonomy";
import type { SubscriptionRow } from "@/lib/billing/billing";

/**
 * Everything the tutor's Students pages read and write about one student.
 *
 * Reads lean on RLS: a tutor can already see a student's profile, enrolments,
 * subscription, parent links, attempts, submissions and chat threads, so these
 * are plain table reads scoped by `student_id`. The two things a tutor could
 * not previously reach — the roster with email, and a student's exam level —
 * go through the tutor-only RPCs the 20260923081108 migration added.
 *
 * Writes that RLS refuses come back as an empty result rather than an error,
 * so every UPDATE here selects the row back and treats "nothing" as a denial.
 */

type Tables = Database["public"]["Tables"];

/** One row of the roster, as `tutor_student_directory()` returns it. */
export type DirectoryStudent =
  Database["public"]["Functions"]["tutor_student_directory"]["Returns"][number];

export interface StudentEnrolment {
  id: string;
  subject: SubjectV;
  board: BoardV;
  previous_grade: string | null;
  current_grade: string | null;
  target_grade: string | null;
}

export interface LinkedParent {
  link_id: string;
  parent_id: string;
  display_name: string | null;
  linked_at: string;
}

export interface PendingParentInvite {
  id: string;
  parent_email: string;
  created_at: string;
  expires_at: string;
}

export interface BillingFeedbackRow {
  id: string;
  action: string;
  reason: string | null;
  reason_category: string | null;
  created_at: string;
}

/** The profile fields the record page shows. Never the whole row. */
export interface StudentProfile {
  id: string;
  display_name: string | null;
  level: LevelV | null;
  school: string | null;
  phone: string | null;
  avatar_path: string | null;
  student_invite_code: string | null;
  created_at: string;
  onboarding_completed_at: string | null;
}

/** One student, assembled once and shared by every tab of the record page. */
export interface StudentRecord {
  profile: StudentProfile;
  enrolments: StudentEnrolment[];
  subscription: SubscriptionRow | null;
  parents: LinkedParent[];
  pendingInvites: PendingParentInvite[];
  billingFeedback: BillingFeedbackRow[];
}

/** A deletion booked on a student, while it can still be undone. */
export interface AccountDeletion {
  id: string;
  requested_at: string;
  purge_after: string;
  last_error: string | null;
}

/**
 * Calls the delete-account edge function, surfacing its own error message
 * rather than "Edge Function returned a non-2xx status code" (see invokeBilling).
 */
async function invokeDeleteAccount<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("delete-account", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const parsed = await ctx.json().catch(() => null);
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export interface StudentNote {
  id: string;
  student_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface StudentSubmission {
  id: string;
  resource_id: string;
  submitted_at: string;
  grade: string | null;
  score_pct: number | null;
  feedback: string | null;
  graded_at: string | null;
  release_at: string | null;
  acknowledged_at: string | null;
  resource: {
    title: string;
    subject: SubjectV;
    due_at: string | null;
    origin: Database["public"]["Enums"]["resource_origin"];
  } | null;
}

export interface StudentAttempt {
  id: string;
  set_id: string;
  score: number;
  total: number;
  created_at: string;
  set: { title: string; subject: SubjectV | null } | null;
}

export interface StudentThread {
  id: string;
  subject_line: string;
  subject: SubjectV | null;
  status: string;
  context_label: string | null;
  last_message_at: string;
  tutor_last_read_at: string | null;
}

/** Fields a tutor may change on an enrolment. Subject is not one of them. */
export type EnrolmentPatch = Partial<
  Pick<
    Tables["student_enrolments"]["Update"],
    "board" | "previous_grade" | "current_grade" | "target_grade"
  >
>;

const SUBSCRIPTION_COLUMNS =
  "user_id, student_id, status, plan, current_period_end, cancel_at_period_end, stripe_subscription_id";

export class StudentsDAL {
  /** Every student, with email — tutor-only, refused server-side for anyone else. */
  static async listDirectory(): Promise<DirectoryStudent[]> {
    const { data, error } = await supabase.rpc("tutor_student_directory");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  /** Subjects per student, for the roster columns. One read for the whole list. */
  static async listEnrolmentsByStudent(): Promise<Record<string, StudentEnrolment[]>> {
    const { data, error } = await supabase
      .from("student_enrolments")
      .select("id, student_id, subject, board, previous_grade, current_grade, target_grade")
      .order("subject");
    if (error) throw new Error(error.message);
    const out: Record<string, StudentEnrolment[]> = {};
    for (const row of data ?? []) {
      const { student_id, ...rest } = row;
      (out[student_id] ??= []).push(rest as StudentEnrolment);
    }
    return out;
  }

  /** Subscriptions per student, for the roster's plan column. */
  static async listSubscriptionsByStudent(): Promise<Record<string, SubscriptionRow>> {
    const { data, error } = await supabase.from("subscriptions").select(SUBSCRIPTION_COLUMNS);
    if (error) throw new Error(error.message);
    const out: Record<string, SubscriptionRow> = {};
    for (const row of (data ?? []) as SubscriptionRow[]) out[row.student_id] = row;
    return out;
  }

  static async getRecord(studentId: string): Promise<StudentRecord | null> {
    const [profile, enrolments, subscription, links, invites, feedback] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, display_name, level, school, phone, avatar_path, student_invite_code, created_at, onboarding_completed_at, role",
        )
        .eq("id", studentId)
        .maybeSingle(),
      supabase
        .from("student_enrolments")
        .select("id, subject, board, previous_grade, current_grade, target_grade")
        .eq("student_id", studentId)
        .order("subject"),
      supabase
        .from("subscriptions")
        .select(SUBSCRIPTION_COLUMNS)
        .eq("student_id", studentId)
        .maybeSingle(),
      supabase
        .from("parent_student_links")
        .select("id, parent_id, created_at")
        .eq("student_id", studentId)
        .order("created_at"),
      supabase
        .from("parent_link_invites")
        .select("id, parent_email, created_at, expires_at")
        .eq("student_id", studentId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("billing_feedback")
        .select("id, action, reason, reason_category, created_at")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false }),
    ]);
    for (const r of [profile, enrolments, subscription, links, invites, feedback]) {
      if (r.error) throw new Error(r.error.message);
    }
    // A tutor or parent id is a valid profile but not a student record.
    if (!profile.data || profile.data.role !== "student") return null;

    // No foreign key from links to profiles, so the parents' names are a
    // second read rather than an embed.
    const parentIds = (links.data ?? []).map((l) => l.parent_id);
    const parentNames: Record<string, string | null> = {};
    if (parentIds.length > 0) {
      const { data: parents, error } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", parentIds);
      if (error) throw new Error(error.message);
      for (const p of parents ?? []) parentNames[p.id] = p.display_name;
    }

    const { role: _role, ...profileFields } = profile.data;
    return {
      profile: profileFields as StudentProfile,
      enrolments: (enrolments.data ?? []) as StudentEnrolment[],
      subscription: (subscription.data as SubscriptionRow | null) ?? null,
      parents: (links.data ?? []).map((l) => ({
        link_id: l.id,
        parent_id: l.parent_id,
        display_name: parentNames[l.parent_id] ?? null,
        linked_at: l.created_at,
      })),
      pendingInvites: (invites.data ?? []) as PendingParentInvite[],
      billingFeedback: (feedback.data ?? []) as BillingFeedbackRow[],
    };
  }

  static async setLevel(studentId: string, level: LevelV): Promise<void> {
    const { error } = await supabase.rpc("tutor_set_student_level", {
      _student_id: studentId,
      _level: level,
    });
    if (error) throw new Error(error.message);
  }

  static async updateEnrolment(
    studentId: string,
    subject: SubjectV,
    patch: EnrolmentPatch,
  ): Promise<StudentEnrolment> {
    const { data, error } = await supabase
      .from("student_enrolments")
      .update(patch)
      .eq("student_id", studentId)
      .eq("subject", subject)
      .select("id, subject, board, previous_grade, current_grade, target_grade")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This enrolment couldn't be changed from your account.");
    return data as StudentEnrolment;
  }

  static async unlinkParent(linkId: string): Promise<void> {
    const { data, error } = await supabase
      .from("parent_student_links")
      .delete()
      .eq("id", linkId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("This link couldn't be removed from your account.");
  }

  /** The open deletion on this student, if one is booked. Tutor-only by RLS. */
  static async getOpenDeletion(studentId: string): Promise<AccountDeletion | null> {
    const { data, error } = await supabase
      .from("account_deletions")
      .select("id, requested_at, purge_after, last_error")
      .eq("student_id", studentId)
      .eq("status", "scheduled")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  /** Books the deletion: pauses the plan, locks the login, emails everyone. */
  static async scheduleDeletion(
    studentId: string,
  ): Promise<{ purge_after: string; emails_failed: number }> {
    return invokeDeleteAccount({ action: "schedule", student_id: studentId });
  }

  static async undoDeletion(
    studentId: string,
  ): Promise<{ plan_resumed: boolean; plan_error: string | null }> {
    return invokeDeleteAccount({ action: "undo", student_id: studentId });
  }

  static async listNotes(studentId: string): Promise<StudentNote[]> {
    const { data, error } = await supabase
      .from("student_tutor_notes")
      .select("id, student_id, author_id, body, created_at, updated_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as StudentNote[];
  }

  static async addNote(studentId: string, body: string): Promise<StudentNote> {
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");
    const { data, error } = await supabase
      .from("student_tutor_notes")
      .insert({ student_id: studentId, author_id: uid, body: body.trim() })
      .select("id, student_id, author_id, body, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return data as StudentNote;
  }

  static async updateNote(noteId: string, body: string): Promise<StudentNote> {
    const { data, error } = await supabase
      .from("student_tutor_notes")
      .update({ body: body.trim() })
      .eq("id", noteId)
      .select("id, student_id, author_id, body, created_at, updated_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This note couldn't be changed from your account.");
    return data as StudentNote;
  }

  static async deleteNote(noteId: string): Promise<void> {
    const { data, error } = await supabase
      .from("student_tutor_notes")
      .delete()
      .eq("id", noteId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("This note couldn't be removed from your account.");
  }

  static async listSubmissions(studentId: string): Promise<StudentSubmission[]> {
    const { data, error } = await supabase
      .from("homework_submissions")
      .select(
        "id, resource_id, submitted_at, grade, score_pct, feedback, graded_at, release_at, acknowledged_at, resource:resources(title, subject, due_at, origin)",
      )
      .eq("student_id", studentId)
      .order("submitted_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as StudentSubmission[];
  }

  static async listAttempts(studentId: string): Promise<StudentAttempt[]> {
    const { data, error } = await supabase
      .from("mcq_attempts")
      .select("id, set_id, score, total, created_at, set:mcq_sets(title, subject)")
      .eq("user_id", studentId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as StudentAttempt[];
  }

  static async listThreads(studentId: string): Promise<StudentThread[]> {
    const { data, error } = await supabase
      .from("chat_threads")
      .select(
        "id, subject_line, subject, status, context_label, last_message_at, tutor_last_read_at",
      )
      .eq("student_id", studentId)
      .order("last_message_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as StudentThread[];
  }
}
