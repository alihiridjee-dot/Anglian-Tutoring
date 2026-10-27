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

/**
 * Whether this student has watched the welcome video to the end, on this
 * device.
 *
 * Only a convenience, so it lives in localStorage rather than on the profile:
 * it spares a student who leaves partway through the tour from sitting through
 * the video again before the tour picks up. Finishing the tour is what the
 * profile records, and after that the video never plays by itself.
 */
const VIDEO_WATCHED = "anglia.welcome-video-watched.v1";

/**
 * Also kept for this page load. A new student watches the video on the payment
 * page and is taken to the tour without a reload, so the tour must know even
 * where storage is blocked, or it would play the video a second time.
 */
const watchedThisVisit = new Set<string>();

function local(): Storage | null {
  // Safari in private mode throws on access rather than returning null.
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readWelcomeVideoWatched(userId: string): boolean {
  if (watchedThisVisit.has(userId)) return true;
  try {
    return !!local()?.getItem(`${VIDEO_WATCHED}:${userId}`);
  } catch {
    return false;
  }
}

export function markWelcomeVideoWatched(userId: string): void {
  watchedThisVisit.add(userId);
  try {
    local()?.setItem(`${VIDEO_WATCHED}:${userId}`, new Date().toISOString());
  } catch {
    // Blocked or full: the video plays once more, which does no harm.
  }
}
