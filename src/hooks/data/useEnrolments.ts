import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ProfileRole = Database["public"]["Enums"]["profile_role"];

export interface EnrolmentsState {
  loading: boolean;
  role: ProfileRole | null;
  enrolledCourses: string[];
  inviteCode: string | null;
}

/** Reads the current user's profile row (role + enrolled subjects). */
export function useEnrolments(): EnrolmentsState {
  const isDemo =
    typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";

  const { data, isLoading } = useQuery({
    queryKey: ["user-enrolments-and-profile"],
    queryFn: async () => {
      if (isDemo) {
        return {
          role: "parent" as ProfileRole,
          enrolledCourses: ["biology", "chemistry", "physics"],
          inviteCode: "DEMO123",
        };
      }
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        return {
          role: null,
          enrolledCourses: [],
          inviteCode: null,
        };
      }
      const { data } = await supabase
        .from("profiles")
        .select("role, enrolled_courses, student_invite_code")
        .eq("id", uid)
        .maybeSingle();

      return {
        role: (data?.role ?? "student") as ProfileRole,
        enrolledCourses: (data?.enrolled_courses ?? []) as string[],
        inviteCode: data?.student_invite_code ?? null,
      };
    },
    staleTime: 1000 * 60 * 10, // 10 minutes cache
    gcTime: 1000 * 60 * 30, // 30 minutes garbage collection
  });

  if (isDemo) {
    return {
      loading: false,
      role: "parent" as ProfileRole,
      enrolledCourses: ["biology", "chemistry", "physics"],
      inviteCode: "DEMO123",
    };
  }

  return {
    loading: isLoading,
    role: data?.role ?? null,
    enrolledCourses: data?.enrolledCourses ?? [],
    inviteCode: data?.inviteCode ?? null,
  };
}
