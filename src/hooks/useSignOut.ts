import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clearAllDrafts } from "@/lib/homework/homeworkDrafts";

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
    const { error } = await supabase.auth.signOut();
    if (error) {
      // On a network failure auth-js returns before it removes the stored
      // session, so the next load would still be signed in. Drop it here and
      // reload, which also discards the copy the client holds in memory.
      forgetStoredSession();
      window.location.replace("/");
      return;
    }
    // A bare acknowledgement the user is already navigating away from — the
    // 4s sonner default leaves it sitting over the landing page.
    toast.success("Signed out", { duration: 2000 });
    navigate({ to: "/", replace: true });
  }, [navigate, qc]);
}

/** Removes Supabase's persisted auth keys (`sb-<ref>-auth-token` and friends). */
function forgetStoredSession() {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sb-") && key.includes("-auth-token")) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage blocked: the session only ever lived in memory, and the reload clears it.
  }
}
