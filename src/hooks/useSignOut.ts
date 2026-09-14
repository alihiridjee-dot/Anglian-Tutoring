import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clearAllDrafts } from "@/lib/homeworkDrafts";

/**
 * Signs the user out and clears every cached row on the way.
 *
 * Shared by the sidebar and the header menu so the teardown order stays in one
 * place: in-flight queries are cancelled and the cache emptied *before* the
 * session goes, or a refetch can resolve against the dead session and repopulate
 * the cache with the previous user's data behind the login screen.
 */
export function useSignOut() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  return useCallback(async () => {
    await qc.cancelQueries();
    qc.clear();
    clearAllDrafts();
    await supabase.auth.signOut();
    // A bare acknowledgement the user is already navigating away from — the
    // 4s sonner default leaves it sitting over the landing page.
    toast.success("Signed out", { duration: 2000 });
    navigate({ to: "/", replace: true });
  }, [navigate, qc]);
}
