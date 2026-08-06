import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clearSignedUrlCache } from "@/lib/signedUrlCache";
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
    // Signed URLs live outside React Query; without this the next user on a
    // shared machine inherits working links to the previous student's work.
    clearSignedUrlCache();
    clearAllDrafts();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/", replace: true });
  }, [navigate, qc]);
}
