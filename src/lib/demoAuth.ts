import { supabase } from "@/integrations/supabase/client";

export const DEMO_EMAIL = "asa180@live.co.uk";
export const DEMO_PASSWORD = "1234abcd";

/**
 * Sign in as the seeded principal tutor. If the account doesn't exist yet,
 * create it (auto-confirm is enabled, so a session is returned immediately).
 * Idempotent — safe to call multiple times.
 */
export async function ensureDemoTutorSession(): Promise<boolean> {
  const { data: existing } = await supabase.auth.getUser();
  if (existing.user) return true;

  const signIn = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (signIn.data.session) return true;

  const signUp = await supabase.auth.signUp({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    options: { data: { display_name: "Principal Tutor" } },
  });
  if (signUp.data.session) return true;

  // Signup may have created the user but no session (rare). Retry sign-in.
  const retry = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  return !!retry.data.session;
}

/**
 * Enters public demo sandbox mode.
 * Establishes an active sandbox session, sets local storage flags,
 * and configures the user experience as a student preview.
 */
export async function enterDemoMode(): Promise<boolean> {
  try {
    const success = await ensureDemoTutorSession();
    if (success) {
      localStorage.setItem("studyhub:is-demo", "true");
      localStorage.setItem("studyhub:view-as", "student");
      return true;
    }
    return false;
  } catch (error) {
    console.error("Failed to initialize demo sandbox mode:", error);
    return false;
  }
}
