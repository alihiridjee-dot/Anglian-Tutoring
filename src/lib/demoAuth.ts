import { supabase } from "@/integrations/supabase/client";
import { markDemoSession, type DemoRole } from "@/lib/auth/session";

// Seeded public demo accounts. These are shared sandbox logins. The demo student
// reads the same curriculum as real students, but row-level security limits it to
// one MCQ set, one homework, and no live sessions. The password is intentionally
// shipped client-side.
export const DEMO_STUDENT_EMAIL = "demo.student@angliantutoring.app";
export const DEMO_PARENT_EMAIL = "demo.parent@angliantutoring.app";
export const DEMO_PASSWORD = "AnglianDemo2026";

/**
 * Enters the public demo sandbox by signing in as the seeded demo student or
 * parent. All demo data is read from the same database as production, scoped by
 * RLS via the account's is_demo flag. Sets local flags used purely for UI
 * affordances (the demo banner / exit button).
 */
export async function enterDemoMode(role: DemoRole = "student"): Promise<boolean> {
  try {
    const email = role === "parent" ? DEMO_PARENT_EMAIL : DEMO_STUDENT_EMAIL;
    await supabase.auth.signOut();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: DEMO_PASSWORD,
    });
    if (error || !data.session) {
      console.error("Failed to enter demo mode:", error);
      return false;
    }
    markDemoSession(role);
    return true;
  } catch (error) {
    console.error("Failed to initialize demo sandbox mode:", error);
    return false;
  }
}
