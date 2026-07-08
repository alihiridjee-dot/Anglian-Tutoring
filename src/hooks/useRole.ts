import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "student" | "tutor" | "admin";

const VIEW_KEY = "studyhub:view-as"; // "student" | "tutor"

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnap() {
  if (typeof window === "undefined") return "tutor";
  return localStorage.getItem(VIEW_KEY) ?? "tutor";
}

export function setViewAs(v: "student" | "tutor") {
  localStorage.setItem(VIEW_KEY, v);
  emit();
}
export function useViewAs(): "student" | "tutor" {
  return useSyncExternalStore(subscribe, getSnap, () => "tutor") as "student" | "tutor";
}

export function useRoles() {
  const viewAs = useViewAs();

  const { data, isLoading } = useQuery({
    queryKey: ["user-roles-and-profile"],
    queryFn: async () => {
      const { data: uData, error: uError } = await supabase.auth.getUser();
      if (uError || !uData.user) {
        return null;
      }
      const user = uData.user;

      const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", user.id);

      return {
        userId: user.id,
        email: user.email ?? null,
        roles: (r ?? []).map((row) => row.role as AppRole),
      };
    },
    staleTime: 1000 * 60 * 10, // 10 minutes cache
    gcTime: 1000 * 60 * 30, // 30 minutes garbage collection
  });

  const roles = data?.roles ?? null;
  const userId = data?.userId ?? null;
  const email = data?.email ?? null;

  const isDemoMode =
    typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
  const demoRole =
    typeof window !== "undefined" ? localStorage.getItem("studyhub:demo-role") : null;

  const actualIsTutor =
    !isDemoMode && !!roles && (roles.includes("tutor") || roles.includes("admin"));
  // Preview toggle: tutors can "view as student"
  const isTutor = !isDemoMode && actualIsTutor && viewAs === "tutor";

  return {
    roles: isDemoMode ? ["student" as AppRole] : roles,
    isTutor,
    actualIsTutor,
    userId: isDemoMode ? "demo-student-id" : userId,
    email: isDemoMode
      ? demoRole === "student"
        ? "demo.student@example.com"
        : "demo.parent@example.com"
      : email,
    loading: isDemoMode ? false : isLoading,
    viewAs: isDemoMode ? "student" : viewAs,
  };
}
