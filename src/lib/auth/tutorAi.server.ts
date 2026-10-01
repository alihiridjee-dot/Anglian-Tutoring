import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SupabaseServer = SupabaseClient<Database>;

/**
 * Model calls one tutor may make per hour through a tutor-only drafting tool.
 * Generous for real use — a busy afternoon of planning is a few dozen — and a
 * ceiling on what a stolen or scripted tutor session can spend.
 */
const TUTOR_AI_PER_HOUR = 60;

/**
 * Gate for the tutor's AI drafting tools (session blurbs, spec-point
 * suggestions, weekly summaries and feedback). Signed in is not enough: any
 * free student or parent account could otherwise call these server functions
 * directly and spend on the model. Checks the tutor role, then claims one
 * request against the per-user hourly budget in `claim_ai_request`.
 */
export async function requireTutorAi(
  supabase: SupabaseServer,
  userId: string,
  endpoint: string,
): Promise<void> {
  const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((role ?? []) as Array<{ role: string }>).map((r) => r.role);
  if (!roles.includes("tutor")) throw new Error("Tutor access required");

  const { data: allowed, error } = await supabase.rpc("claim_ai_request", {
    _endpoint: endpoint,
    _limit: TUTOR_AI_PER_HOUR,
    _window: "01:00:00",
  });
  if (error || !allowed)
    throw new Error("You've used the AI drafting tools a lot this hour. Try again shortly.");
}
