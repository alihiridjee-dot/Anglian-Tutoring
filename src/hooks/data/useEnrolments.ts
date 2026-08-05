import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode, getDemoRole } from "@/lib/auth/session";
import {
  DEMO_SUBJECTS,
  DEMO_STUDENT_NAME,
  DEMO_PARENT_NAME,
  DEMO_ENROLMENTS,
  DEMO_LEVEL,
} from "@/lib/demo/studentDemo";
import type { Database } from "@/integrations/supabase/types";
import { getSessionUserId } from "@/lib/auth/session";

export type ProfileRole = Database["public"]["Enums"]["profile_role"];
export type BoardV = Database["public"]["Enums"]["board"];
export type LevelV = Database["public"]["Enums"]["level"];
export type SubjectV = Database["public"]["Enums"]["subject"];

/** One enrolled subject and the exam board the student sits it with. */
export interface Enrolment {
  subject: string;
  board: BoardV;
}

export interface EnrolmentsState {
  loading: boolean;
  role: ProfileRole | null;
  enrolledCourses: string[];
  /** Per-subject enrolments, each carrying its own exam board. */
  enrolments: Enrolment[];
  /** The student's shared exam level (gcse/alevel), or null if unset. */
  level: LevelV | null;
  inviteCode: string | null;
  /**
   * The name the user chose on their profile, or null if they've never set one.
   *
   * This is the single source for how the app addresses someone. Read it here
   * rather than deriving a name from the email — the profile form invalidates
   * this query on save, so every consumer updates together, and an
   * email-derived name would silently ignore the edit.
   */
  displayName: string | null;
}

/** Reads the current user's profile row (name + role + enrolled subjects). */
export function useEnrolments(): EnrolmentsState {
  const { data, isLoading } = useQuery({
    queryKey: ["user-enrolments-and-profile"],
    queryFn: async () => {
      // The showcase has no session, so a real read would return nothing and
      // every page would render its "not enrolled yet" empty state.
      if (isDemoMode()) {
        return {
          role: (getDemoRole() === "parent" ? "parent" : "student") as ProfileRole,
          enrolledCourses: [...DEMO_SUBJECTS],
          enrolments: DEMO_ENROLMENTS.map((e) => ({ ...e })) as Enrolment[],
          level: DEMO_LEVEL as LevelV,
          inviteCode: null,
          displayName: getDemoRole() === "parent" ? DEMO_PARENT_NAME : DEMO_STUDENT_NAME,
        };
      }

      const uid = await getSessionUserId();
      if (!uid) {
        return {
          role: null,
          enrolledCourses: [],
          enrolments: [],
          level: null,
          inviteCode: null,
          displayName: null,
        };
      }
      const [{ data }, { data: enrolRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("role, enrolled_courses, student_invite_code, display_name, level")
          .eq("id", uid)
          .maybeSingle(),
        supabase
          .from("student_enrolments")
          .select("subject, board")
          .eq("student_id", uid)
          .order("subject", { ascending: true }),
      ]);

      const enrolments = (enrolRows ?? []).map((r) => ({
        subject: r.subject as string,
        board: r.board as BoardV,
      }));

      return {
        role: (data?.role ?? "student") as ProfileRole,
        // Prefer the per-subject table; fall back to the legacy subject array
        // so a student with no enrolment rows yet still resolves their subjects.
        enrolledCourses:
          enrolments.length > 0
            ? enrolments.map((e) => e.subject)
            : ((data?.enrolled_courses ?? []) as string[]),
        enrolments,
        level: (data?.level ?? null) as LevelV | null,
        inviteCode: data?.student_invite_code ?? null,
        // Blank is the same as unset — a name of "" would render as an empty
        // greeting rather than falling back.
        displayName: data?.display_name?.trim() || null,
      };
    },
    staleTime: 1000 * 60 * 10, // 10 minutes cache
    gcTime: 1000 * 60 * 30, // 30 minutes garbage collection
  });

  return {
    loading: isLoading,
    role: data?.role ?? null,
    enrolledCourses: data?.enrolledCourses ?? [],
    enrolments: data?.enrolments ?? [],
    level: data?.level ?? null,
    inviteCode: data?.inviteCode ?? null,
    displayName: data?.displayName ?? null,
  };
}

/**
 * Move one enrolled subject onto a different exam board.
 *
 * The board is what scopes every piece of content on the account — topics,
 * videos, quizzes, homework, the weekly focus and the planner are all keyed by
 * (level, board, subject) — but it is deliberately *not* priced: plans are sold
 * on subject count and cadence alone, so a student sitting Biology with OCR pays
 * exactly what one sitting it with AQA pays. That is why this writes straight to
 * the enrolment row rather than going through the billing edge function: there
 * is nothing for Stripe to do.
 *
 * RLS ("enrolments self update") allows the student themselves and nobody else —
 * not even a linked parent — so only offer this on the signed-in student's own
 * enrolments.
 */
export function useUpdateEnrolmentBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      studentId,
      subject,
      board,
    }: {
      studentId: string;
      subject: SubjectV;
      board: BoardV;
    }) => {
      const { data, error } = await supabase
        .from("student_enrolments")
        .update({ board })
        .eq("student_id", studentId)
        .eq("subject", subject)
        .select("subject, board");
      if (error) throw new Error(error.message);
      // RLS refuses a write by matching no rows rather than erroring, so an
      // empty result is a denial — reporting it as success would leave the UI
      // showing a board the database never accepted.
      if (!data?.length) {
        throw new Error("Only the student's own account can change their exam board.");
      }
      return { subject, board };
    },
    onSuccess: () => {
      // Curriculum, videos, quizzes, homework, weekly focus and the planner are
      // every one of them board-scoped, so a switch invalidates essentially the
      // whole account. Blanket rather than enumerated on purpose: a key missed
      // here leaves the student reading another board's spec, which is far worse
      // than a refetch they didn't need.
      qc.invalidateQueries();
    },
  });
}
