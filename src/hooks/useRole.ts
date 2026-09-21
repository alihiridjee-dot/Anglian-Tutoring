import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isStaffRole } from "@/lib/auth/guardState";
import { useViewer } from "@/hooks/useViewer";

export type AppRole = "student" | "tutor" | "admin";

export function useRoles() {
  // Under /_authenticated the guard has already resolved who this is, so the
  // id and the tutor/student split are known on the very first render. Pages
  // used to draw a spinner — and the sidebar a student's nav — until the query
  // below came back, on every hard load.
  const viewer = useViewer();
  // `role: null` is the guard's "couldn't read it" answer. It is a fallback, not
  // a verdict, so it must not settle `loading` — the tutor pages redirect away
  // the moment they are told, with `loading` false, that this isn't a tutor.
  const viewerResolved = !!viewer && viewer.role !== null;

  const { data, isLoading } = useQuery({
    queryKey: ["user-roles-and-profile"],
    queryFn: async () => {
      const { data: sData } = await supabase.auth.getSession();
      const user = sData.session?.user;
      if (!user) {
        return null;
      }

      const { data: r, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      // Thrown, not swallowed: an empty list here means "not a tutor", and this
      // entry is kept for ten minutes. One dropped request used to demote a
      // tutor to a student for that long.
      if (error) throw error;

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
  // The role list is what RLS consults, so it wins once it has arrived; until
  // then the guard's answer stands in for it.
  const isTutor = roles
    ? roles.includes("tutor") || roles.includes("admin")
    : viewerResolved && isStaffRole(viewer.appRole);

  return {
    roles,
    isTutor,
    userId: data?.userId ?? viewer?.userId ?? null,
    email: data?.email ?? null,
    loading: viewerResolved ? false : isLoading,
  };
}
