// Supabase Edge Function: delete-account
//
// A tutor deletes a student's account from the student's record. Seven days
// separate the button from the deletion, so a wrong click can be undone:
//
//   schedule  (tutor)  pause the Stripe plan, ban the login, record the request
//                      in public.account_deletions, email everyone concerned
//   undo      (tutor)  lift the ban and resume the plan this request paused
//   purge     (cron)   for every request past its date: cancel the plan, delete
//                      the student's own Stripe customer, their files and the
//                      rows no foreign key reaches, then the auth user (which
//                      cascades through the rest), and send the last emails
//
// "purge" takes no caller. The hourly cron in 20260923114330 calls it without a
// key, so this function is deployed with verify_jwt off. That is safe because a
// purge only acts on rows already scheduled and already due — rows only a tutor
// can create, through "schedule" — so calling it early or often changes nothing,
// and it answers with counts, never with who was deleted.
//
// Money: no refund. Day 0 pauses collection ("void", like the pause button);
// day 7 cancels without proration.
//
// Required function secrets (set with `supabase secrets set ...`):
//   STRIPE_SECRET_KEY, RESEND_API_KEY,
//   EMAIL_FROM  e.g. "Anglia Educate <hello@angliaeducate.co.uk>" — a domain
//               verified in Resend
// Auto-injected by the platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { corsHeaders, HttpError } from "../_shared/http.ts";
import { admin, stripeClient } from "../_shared/clients.ts";
import { isStaff, requireUser } from "../stripe-checkout/auth.ts";
import { buildEmail, formatUkDate, type EmailKind, type Recipient } from "./emails.ts";

const COOLING_OFF_DAYS = 7;
/** GoTrue has no "forever"; a hundred years is its conventional stand-in. */
const BAN_FOREVER = "876000h";
/** Subscription statuses that can still charge. */
const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid"];
/** A purge that has held a row this long has died; the next run may take it. */
const CLAIM_TIMEOUT_MS = 15 * 60_000;

/**
 * Student data with no foreign key to the account, so the auth delete does not
 * reach it. Everything else is keyed to auth.users or profiles with ON DELETE
 * CASCADE (checked against production on 2026-09-23). Children of these —
 * homework answers, AI marks, their notifications — cascade from them.
 */
const UNLINKED_TABLES: [table: string, column: string][] = [
  ["homework_submissions", "student_id"],
  ["mcq_attempts", "user_id"],
  ["session_attendees", "user_id"],
  ["parent_student_links", "student_id"],
];

type Db = ReturnType<typeof admin>;

interface DeletionRow {
  id: string;
  student_id: string;
  purge_after: string;
  notify: Recipient[];
  student_name: string | null;
  paused_subscription_id: string | null;
  attempts: number;
}

const DELETION_COLUMNS =
  "id, student_id, purge_after, notify, student_name, paused_subscription_id, attempts";

interface Payload {
  action: "schedule" | "undo" | "purge";
  student_id?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The caller, who must be staff. */
async function requireStaff(req: Request) {
  const user = await requireUser(req);
  if (!(await isStaff(user.id))) throw new HttpError(403, "Only a tutor can delete an account.");
  return user;
}

/**
 * Rows free to act on: nobody is purging them, or whoever was has died. A
 * PostgREST `or` filter; the timestamp is quoted so its dots and colons are
 * read as the value, not as filter syntax.
 */
function unclaimed() {
  const stale = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
  return `claimed_at.is.null,claimed_at.lt."${stale}"`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stripe's "that object doesn't exist", which for a deletion means done. */
function isMissing(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number };
  return e?.code === "resource_missing" || e?.statusCode === 404;
}

/**
 * Everyone told about this deletion: the student, each linked parent, whoever
 * pays if that is someone else, and the tutor who pressed the button. Captured
 * now because by day 7 the account and its parent links no longer exist.
 */
async function recipients(
  db: Db,
  studentId: string,
  studentEmail: string | undefined,
  studentName: string | null,
  staff: { id: string; email?: string },
): Promise<Recipient[]> {
  const out: Recipient[] = [];
  const add = (
    email: string | undefined | null,
    name: string | null,
    audience: Recipient["audience"],
  ) => {
    const e = email?.trim().toLowerCase();
    if (!e || out.some((r) => r.email === e)) return;
    out.push({ email: e, name, audience });
  };

  add(studentEmail, studentName, "student");

  const [{ data: links }, { data: sub }] = await Promise.all([
    db.from("parent_student_links").select("parent_id").eq("student_id", studentId),
    db.from("subscriptions").select("user_id").eq("student_id", studentId).maybeSingle(),
  ]);
  const parentIds = new Set<string>((links ?? []).map((l: { parent_id: string }) => l.parent_id));
  if (sub?.user_id && sub.user_id !== studentId) parentIds.add(sub.user_id);

  for (const id of parentIds) {
    const [{ data: u }, { data: p }] = await Promise.all([
      db.auth.admin.getUserById(id),
      db.from("profiles").select("display_name").eq("id", id).maybeSingle(),
    ]);
    add(u?.user?.email, p?.display_name ?? null, "parent");
  }

  const { data: me } = await db
    .from("profiles")
    .select("display_name")
    .eq("id", staff.id)
    .maybeSingle();
  add(staff.email, me?.display_name ?? null, "staff");

  return out;
}

/**
 * Send one stage's email to everyone on the list. Never throws: an email that
 * fails must not stop a deletion or an undo. Returns how many failed; the
 * reasons go to the function log, not the table, since they carry addresses.
 */
async function sendAll(
  kind: EmailKind,
  to: Recipient[],
  ctx: { studentName: string; purgeAfter: string; planResumed?: boolean },
): Promise<number> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!key || !from) {
    console.error("delete-account: RESEND_API_KEY or EMAIL_FROM not set; no emails sent");
    return to.length;
  }

  const studentEmail = to.find((r) => r.audience === "student")?.email ?? null;
  const staffEmail = to.find((r) => r.audience === "staff")?.email;
  let failed = 0;

  for (const r of to) {
    const email = buildEmail(kind, r, {
      studentName: ctx.studentName,
      studentEmail,
      purgeDate: formatUkDate(ctx.purgeAfter),
      planResumed: ctx.planResumed,
    });
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [r.email],
          subject: email.subject,
          text: email.text,
          html: email.html,
          // A family replying "this is a mistake" reaches the tutor who did it.
          ...(staffEmail && r.audience !== "staff" ? { reply_to: staffEmail } : {}),
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    } catch (err) {
      failed++;
      console.error(`delete-account: ${kind} email to ${r.audience} failed:`, errorText(err));
    }
  }
  return failed;
}

/**
 * Stop the student's plan charging, reversibly. Returns the subscription it
 * paused, or null when there was nothing to pause — no plan, a dead one, or one
 * the family had already paused (which undo must then leave paused).
 */
async function pausePlan(db: Db, stripe: Stripe, studentId: string): Promise<string | null> {
  const { data: sub } = await db
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("student_id", studentId)
    .maybeSingle();
  if (!sub?.stripe_subscription_id || !LIVE_STATUSES.includes(sub.status ?? "")) return null;

  const live = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  if (live.status === "canceled" || live.pause_collection) return null;

  await stripe.subscriptions.update(live.id, { pause_collection: { behavior: "void" } });
  // Mirror now rather than wait for the webhook, as stripe-checkout's pause does.
  await db
    .from("subscriptions")
    .update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", live.id);
  return live.id;
}

async function resumePlan(db: Db, stripe: Stripe, subscriptionId: string) {
  const sub = await stripe.subscriptions.update(subscriptionId, { pause_collection: "" });
  await db
    .from("subscriptions")
    .update({ status: sub.status, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscriptionId);
}

// ── schedule ────────────────────────────────────────────────────────────────

async function handleSchedule(req: Request, studentId: string | undefined) {
  const caller = await requireStaff(req);
  if (!studentId) throw new HttpError(400, "student_id is required.");
  if (studentId === caller.id) throw new HttpError(400, "You can't delete your own account.");

  const db = admin();
  const stripe = stripeClient();

  // A student, and only a student: never a tutor, a parent or an admin.
  const { data: profile } = await db
    .from("profiles")
    .select("display_name, role")
    .eq("id", studentId)
    .maybeSingle();
  if (profile?.role !== "student" || (await isStaff(studentId))) {
    throw new HttpError(404, "That isn't a student account.");
  }
  const { data: auth } = await db.auth.admin.getUserById(studentId);
  if (!auth?.user) throw new HttpError(404, "That student has no login.");

  const studentName =
    profile.display_name?.trim() || auth.user.email?.split("@")[0] || "The student";
  const notify = await recipients(db, studentId, auth.user.email, profile.display_name, caller);
  const purgeAfter = new Date(Date.now() + COOLING_OFF_DAYS * 86_400_000).toISOString();

  // The row first: its unique index turns a second click into a clean refusal
  // rather than a second pause and a second round of emails.
  const { data: row, error } = await db
    .from("account_deletions")
    .insert({
      student_id: studentId,
      requested_by: caller.id,
      purge_after: purgeAfter,
      notify,
      student_name: studentName,
    })
    .select("id")
    .single();
  if (error?.code === "23505")
    throw new HttpError(409, "This account is already booked for deletion.");
  if (error || !row) throw new HttpError(500, `Couldn't book the deletion: ${error?.message}`);

  // Pause, then lock out. If either fails, put back what was done and drop the
  // row, so a failed request leaves the student exactly as they were.
  let paused: string | null = null;
  try {
    paused = await pausePlan(db, stripe, studentId);
    if (paused) {
      await db
        .from("account_deletions")
        .update({ paused_subscription_id: paused })
        .eq("id", row.id);
    }
    const { error: banError } = await db.auth.admin.updateUserById(studentId, {
      ban_duration: BAN_FOREVER,
    });
    if (banError) throw new Error(`Couldn't lock the login: ${banError.message}`);
  } catch (err) {
    if (paused) await resumePlan(db, stripe, paused).catch(() => {});
    await db.from("account_deletions").delete().eq("id", row.id);
    throw new HttpError(502, errorText(err));
  }

  const failed = await sendAll("scheduled", notify, { studentName, purgeAfter });
  if (failed > 0) {
    await db
      .from("account_deletions")
      .update({ last_error: `${failed} of ${notify.length} booking emails failed` })
      .eq("id", row.id);
  }

  return { ok: true, purge_after: purgeAfter, emails_failed: failed };
}

// ── undo ────────────────────────────────────────────────────────────────────

async function handleUndo(req: Request, studentId: string | undefined) {
  const caller = await requireStaff(req);
  if (!studentId) throw new HttpError(400, "student_id is required.");

  const db = admin();
  const { data: row } = await db
    .from("account_deletions")
    .select(DELETION_COLUMNS)
    .eq("student_id", studentId)
    .eq("status", "scheduled")
    .maybeSingle<DeletionRow>();
  if (!row) throw new HttpError(404, "There's no deletion booked for this student.");

  // Taking the row out of "scheduled" is what stops the purge, so it goes
  // first — and only if no purge is holding it right now.
  const { data: freed } = await db
    .from("account_deletions")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: caller.id,
    })
    .eq("id", row.id)
    .eq("status", "scheduled")
    .or(unclaimed())
    .select("id");
  if (!freed?.length) {
    throw new HttpError(409, "The deletion is running right now and can't be stopped.");
  }

  const { error: unbanError } = await db.auth.admin.updateUserById(studentId, {
    ban_duration: "none",
  });
  if (unbanError) {
    // Still locked out, so the deletion stays booked rather than leaving a
    // banned student with nothing scheduled.
    await db
      .from("account_deletions")
      .update({ status: "scheduled", cancelled_at: null, cancelled_by: null })
      .eq("id", row.id);
    throw new HttpError(502, `Couldn't unlock the login: ${unbanError.message}`);
  }

  let planResumed = false;
  let planError: string | null = null;
  if (row.paused_subscription_id) {
    try {
      await resumePlan(db, stripeClient(), row.paused_subscription_id);
      planResumed = true;
    } catch (err) {
      planError = errorText(err);
    }
  }

  await sendAll("cancelled", row.notify, {
    studentName: row.student_name ?? "The student",
    purgeAfter: row.purge_after,
    planResumed,
  });

  // The student is staying, so this row no longer needs to know who to tell.
  await db
    .from("account_deletions")
    .update({ notify: [], student_name: null, last_error: planError })
    .eq("id", row.id);

  return { ok: true, plan_resumed: planResumed, plan_error: planError };
}

// ── purge ───────────────────────────────────────────────────────────────────

async function cancelSubscription(stripe: Stripe, id: string) {
  try {
    const sub = await stripe.subscriptions.retrieve(id);
    // No proration: nothing is credited or refunded for the unused days.
    if (sub.status !== "canceled") await stripe.subscriptions.cancel(id, { prorate: false });
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

async function deleteCustomer(stripe: Stripe, id: string) {
  try {
    await stripe.customers.del(id);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

/**
 * Delete one student for good. Every step is safe to repeat, so a run that dies
 * halfway is finished by the next one.
 */
async function purgeOne(db: Db, stripe: Stripe, row: DeletionRow) {
  const studentId = row.student_id;
  const now = () => new Date().toISOString();

  // 1 · The plan. Marked canceled here too, so the profiles delete trigger does
  //     not queue a second cancellation for stripe-reconcile.
  const { data: subs } = await db
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("student_id", studentId);
  for (const s of subs ?? []) {
    if (!s.stripe_subscription_id) continue;
    await cancelSubscription(stripe, s.stripe_subscription_id);
    await db
      .from("subscriptions")
      .update({ status: "canceled", updated_at: now() })
      .eq("stripe_subscription_id", s.stripe_subscription_id);
  }

  // 2 · The student's own Stripe customer — their name and email at Stripe. A
  //     parent's customer is the parent's, and stays. Stripe keeps the invoices.
  const { data: customers } = await db
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", studentId);
  for (const c of customers ?? []) await deleteCustomer(stripe, c.stripe_customer_id);

  // 3 · Files. Storage is not reached by any cascade.
  const { data: files, error: listError } = await db.storage.from("avatars").list(studentId);
  if (listError) throw new Error(`avatars: ${listError.message}`);
  if (files?.length) {
    const { error } = await db.storage
      .from("avatars")
      .remove(files.map((f: { name: string }) => `${studentId}/${f.name}`));
    if (error) throw new Error(`avatars: ${error.message}`);
  }

  // 4 · Rows no foreign key reaches.
  for (const [table, column] of UNLINKED_TABLES) {
    const { error } = await db.from(table).delete().eq(column, studentId);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  // 5 · The account, which cascades through profiles and everything keyed to it.
  const { error: deleteError } = await db.auth.admin.deleteUser(studentId);
  if (deleteError && !/not.?found/i.test(deleteError.message)) {
    throw new Error(`auth user: ${deleteError.message}`);
  }

  // 6 · Tell them, then forget who they were.
  const failed = await sendAll("completed", row.notify, {
    studentName: row.student_name ?? "The student",
    purgeAfter: row.purge_after,
  });
  await db
    .from("account_deletions")
    .update({
      status: "completed",
      completed_at: now(),
      claimed_at: null,
      notify: [],
      student_name: null,
      last_error: failed > 0 ? `${failed} of ${row.notify.length} deletion emails failed` : null,
    })
    .eq("id", row.id);
}

async function handlePurge() {
  const db = admin();
  const stripe = stripeClient();

  const { data: due, error } = await db
    .from("account_deletions")
    .select("id")
    .eq("status", "scheduled")
    .lte("purge_after", new Date().toISOString())
    .or(unclaimed())
    .order("purge_after")
    .limit(10);
  if (error) throw new HttpError(500, `Couldn't read deletions: ${error.message}`);

  let deleted = 0;
  let failed = 0;
  for (const { id } of due ?? []) {
    // Claim it, so an overlapping run skips it and undo refuses while we work.
    const { data: row } = await db
      .from("account_deletions")
      .update({ claimed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "scheduled")
      .or(unclaimed())
      .select(DELETION_COLUMNS)
      .maybeSingle<DeletionRow>();
    if (!row) continue;

    try {
      await purgeOne(db, stripe, row);
      deleted++;
    } catch (err) {
      failed++;
      console.error(`delete-account: purge of ${row.id} failed:`, errorText(err));
      await db
        .from("account_deletions")
        .update({ claimed_at: null, attempts: row.attempts + 1, last_error: errorText(err) })
        .eq("id", row.id);
    }
  }

  return { ok: true, deleted, failed };
}

// ── Entry ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;
    let result: unknown;
    switch (payload.action) {
      case "schedule":
        result = await handleSchedule(req, payload.student_id);
        break;
      case "undo":
        result = await handleUndo(req, payload.student_id);
        break;
      case "purge":
        result = await handlePurge();
        break;
      default:
        throw new HttpError(400, "Unknown action.");
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = errorText(err);
    console.error("delete-account:", message);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
