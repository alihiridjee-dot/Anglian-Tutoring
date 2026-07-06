import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) return { user: data.user };
    throw redirect({ to: "/auth", search: { redirect: location.href } as never });
  },
  component: () => <Outlet />,
});
