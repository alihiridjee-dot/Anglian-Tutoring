// Who is calling, and what they may do to whose plan.
//
// requireUser resolves the caller from the verified JWT: the payer and the
// manager are always taken from here, never from the request body. The two
// assert* rules are the authority model the whole function rests on, and
// assertCanManage is mirrored by the billing_feedback RLS insert policy so the
// rule holds on both sides.
import { HttpError } from "../_shared/http.ts";
import { admin } from "../_shared/clients.ts";

/** Resolves the caller from the Authorization bearer token. */
export async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new HttpError(401, "Missing authorization header.");
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid session.");
  return data.user;
}

/**
 * Who may manage (pause / resume / cancel / drop a subject from) a student's
 * subscription.
 *
 * Two authorities, either of which is enough:
 *
 *   • the PAYER — whoever's card the plan sits on (subscriptions.user_id). This
 *     is absolute: nobody may be charged with no way to stop it. It is what
 *     rescues the self-paying student who later links a parent — the old
 *     link-only rule left them funding a plan they were locked out of managing.
 *   • a LINKED PARENT of the student — oversight of a child's plan, including
 *     one the child paid for themselves.
 *
 * So the only person refused is a student who neither pays nor is unlinked: a
 * child on a parent-funded plan, who sees status and is pointed at their payer.
 *
 *   • caller is the payer                                  → allowed
 *   • caller is a linked parent of the student             → allowed
 *   • caller IS the student AND no parent is linked        → allowed
 *   • a linked student on someone else's card              → 403
 *
 * Mirrored by the billing_feedback RLS insert policy so the rule holds on both
 * sides. `payerId` comes from the subscription row the caller already loaded;
 * omit it and only the link-based arms apply.
 */
export async function assertCanManage(
  callerId: string,
  studentId: string,
  payerId?: string | null,
) {
  const db = admin();

  if (payerId && callerId === payerId) return; // the payer, always

  const { data: link } = await db
    .from("parent_student_links")
    .select("parent_id")
    .eq("parent_id", callerId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (link) return; // the linked parent

  if (callerId === studentId) {
    const { data: anyParent } = await db
      .from("parent_student_links")
      .select("parent_id")
      .eq("student_id", studentId)
      .limit(1)
      .maybeSingle();
    if (!anyParent) return; // an unlinked student managing their own plan
    throw new HttpError(403, "Your linked parent manages this plan.");
  }

  throw new HttpError(403, "You aren't allowed to manage this plan.");
}

/**
 * Who may UPGRADE (add subjects to) a student's plan. Deliberately looser than
 * assertCanManage: adding a subject is additive growth, so the student may do it
 * for their own plan even when a parent holds the pause/cancel controls, and a
 * linked parent may do it for their child. Only the destructive lifecycle
 * actions stay locked to the billing controller.
 */
export async function assertCanUpgrade(callerId: string, studentId: string) {
  if (callerId === studentId) return; // the student growing their own plan
  const { data: link } = await admin()
    .from("parent_student_links")
    .select("parent_id")
    .eq("parent_id", callerId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (link) return; // the linked parent
  throw new HttpError(403, "You aren't allowed to change this plan.");
}
