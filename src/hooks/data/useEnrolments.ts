import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode, getDemoRole } from "@/lib/auth/session";
import { DEMO_SUBJECTS, DEMO_STUDENT_NAME, DEMO_PARENT_NAME } from "@/lib/demo/studentDemo";
import type { Database } from "@/integrations/supabase/types";

export type ProfileRole = Database["public"]["Enums"]["profile_role"];

export interface EnrolmentsState {
  loading: boolean;
  role: ProfileRole | null;
  enrolledCourses: string[];
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
          inviteCode: null,
          displayName: getDemoRole() === "parent" ? DEMO_PARENT_NAME : DEMO_STUDENT_NAME,
        };
      }

      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        return {
          role: null,
          enrolledCourses: [],
          inviteCode: null,
          displayName: null,
        };
      }
      const { data } = await supabase
        .from("profiles")
        .select("role, enrolled_courses, student_invite_code, display_name")
        .eq("id", uid)
        .maybeSingle();

      return {
        role: (data?.role ?? "student") as ProfileRole,
        enrolledCourses: (data?.enrolled_courses ?? []) as string[],
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
    inviteCode: data?.inviteCode ?? null,
    displayName: data?.displayName ?? null,
  };
}
