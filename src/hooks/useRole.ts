import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "student" | "tutor" | "admin";

export function useRoles() {
  const { data, isLoading } = useQuery({
    queryKey: ["user-roles-and-profile"],
    queryFn: async () => {
      const { data: sData } = await supabase.auth.getSession();
      const user = sData.session?.user;
      if (!user) {
        return null;
      }

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

  return {
    roles,
    isTutor: !!roles && (roles.includes("tutor") || roles.includes("admin")),
    userId: data?.userId ?? null,
    email: data?.email ?? null,
    loading: isLoading,
  };
}
