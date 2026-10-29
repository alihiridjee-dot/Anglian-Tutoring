// What the app sends each edge function, written once and used by both sides:
// a function reads its body under these names, and the app's call is typed
// with them, so a field renamed on one side stops the other from compiling.
// Types only and no imports, so the app's build can import this file too.
//
// A type here describes what the app sends. It checks nothing: a body can
// still be anything. readBody (http.ts) refuses a body that isn't a JSON
// object, and each function checks every field it uses.

// ── stripe-checkout ─────────────────────────────────────────────────────────

/** The app pages Stripe may send the browser back to. Keys, never URLs. */
export type BillingReturnTo = "onboarding" | "billing" | "parent";

export interface CheckoutPayload {
  action: "checkout";
  /** packages.tier — the plan being bought. */
  tier: string;
  /** The student the subscription covers. Defaults to the caller. */
  student_id?: string;
  /** Which app page to land back on. Key into RETURN_PATHS. */
  return_to?: BillingReturnTo;
  /** A free-trial code from the landing page. Checked and held server-side. */
  trial_code?: string;
}

export interface PortalPayload {
  action: "portal";
  return_to?: BillingReturnTo;
}

export interface ManagePayload {
  /**
   * cancel  → cancel_at_period_end: access runs to the period boundary.
   * pause   → stop collecting payment immediately (behaviour "void").
   * resume  → undo either of the above.
   */
  action: "cancel" | "pause" | "resume";
  /** subscriptions.student_id — which subscription of the caller's to act on. */
  student_id: string;
}

export interface AddSubjectsPayload {
  /**
   * Add one or more subjects to an existing live subscription, moving it up the
   * `${cadence}_${count}` matrix (same cadence, higher count) and enrolling the
   * student in the new subjects. The price difference is prorated and invoiced
   * immediately. Caller must manage the plan (assertCanManage).
   */
  action: "add_subjects";
  /** subscriptions.student_id — whose plan to grow. */
  student_id: string;
  /** The subjects to add, each with the board the student will sit it with. */
  subjects: { subject: string; board: string }[];
}

export interface RemoveSubjectsPayload {
  /**
   * Drop subject(s) from a live subscription — the mirror of add_subjects, and
   * the answer to "cancel Chemistry without cancelling everything". Moves the
   * plan DOWN the `${cadence}_${count}` matrix, un-enrols the student and
   * shrinks their access grant.
   *
   * Destructive, so it takes the stricter authority (assertCanManage) rather
   * than the looser upgrade check, and it refuses to empty the plan: removing
   * the last subject is cancelling, which has its own gated flow.
   */
  action: "remove_subjects";
  /** subscriptions.student_id — whose plan to shrink. */
  student_id: string;
  /** Subject slugs to drop. */
  subjects: string[];
}

export interface ChangeCadencePayload {
  /**
   * Switch how often the family is billed (weekly / monthly / termly) on the
   * subscription they already have.
   *
   * This replaces the old "switch plan" path, which ran a fresh Checkout
   * Session: that charged the full new price with no proration AND left the
   * previous Stripe subscription running, because the webhook keys
   * public.subscriptions on student_id and simply overwrote the row. The family
   * was then billed twice with the app aware of only one.
   *
   * The subject COUNT is deliberately not a parameter — it is read from
   * student_enrolments, so a cadence switch can never silently change what the
   * plan covers (the old picker let someone buy `monthly_3` while enrolled in
   * two subjects). Growing or shrinking coverage goes through
   * add_subjects / remove_subjects, which ask which subjects and enrol properly.
   */
  action: "change_cadence";
  /** subscriptions.student_id — whose plan to re-time. */
  student_id: string;
  /** The cadence to move to. */
  cadence: string;
  /** When true, price it and return without touching Stripe or the database. */
  preview?: boolean;
}

export interface InvoicesPayload {
  action: "invoices";
}

export type BillingPayload =
  | CheckoutPayload
  | PortalPayload
  | ManagePayload
  | AddSubjectsPayload
  | RemoveSubjectsPayload
  | ChangeCadencePayload
  | InvoicesPayload;

// ── delete-account ──────────────────────────────────────────────────────────

export interface DeleteAccountPayload {
  /**
   * schedule → a tutor books the student's deletion for seven days' time.
   * undo     → a tutor calls it off inside those seven days.
   * purge    → the hourly cron deletes every booking that is due.
   */
  action: "schedule" | "undo" | "purge";
  /** The student to schedule or undo. Not sent with purge. */
  student_id?: string;
}

// ── mark-homework ───────────────────────────────────────────────────────────

export interface MarkHomeworkPayload {
  /** homework_submissions.id — the work to mark. */
  submissionId: string;
}

// ── trial-code ──────────────────────────────────────────────────────────────

export interface TrialCodePayload {
  /** Where to send the code. */
  email: string;
  /** The landing pop-up's honeypot: hidden from people, so only bots fill it. */
  website?: string;
}
