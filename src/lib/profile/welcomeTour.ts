import { supabase } from "@/integrations/supabase/client";

/**
 * Whether this account has been through the welcome tour, kept on the profile.
 *
 * It used to be a localStorage flag written on the device where setup finished,
 * so a student who set up on a phone and studied on a laptop never saw the tour,
 * and a parent never saw it at all. On the profile it follows the account.
 */

/** When the account finished or skipped the tour, or null if it hasn't yet. */
export async function readWelcomeTourSeen(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("welcome_tour_seen_at")
    .eq("id", userId)
    .maybeSingle();
  // Thrown, so an unreadable answer is never taken for "not seen" — that would
  // start the tour on every visit for as long as the read keeps failing.
  if (error) throw error;
  return data?.welcome_tour_seen_at ?? null;
}

/** Records the tour as done, whether it was finished or skipped. */
export async function markWelcomeTourSeen(userId: string): Promise<string> {
  const seenAt = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({ welcome_tour_seen_at: seenAt })
    .eq("id", userId);
  if (error) throw error;
  return seenAt;
}
