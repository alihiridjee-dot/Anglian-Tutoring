// Supabase Edge Function: new-student-alert
//
// Emails the team when a student finishes setting up their account.
//
// The database does the noticing. When a student's profile gets its
// onboarding_completed_at stamp, a trigger (20261125140000_new_student_alerts)
// adds one row to public.new_student_alerts and calls this function. A cron
// every 15 minutes calls it again while any row is still unsent, so an email
// that failed (Resend down, the function mid-deploy) is retried, up to
// MAX_ATTEMPTS times.
//
// It takes no caller and reads no body, so it is deployed with verify_jwt off.
// That is safe for the same reason delete-account's purge is: it only ever
// emails rows already queued by the trigger, always to the one team address,
// so calling it early or often changes nothing. It answers with counts, never
// with who joined.
//
// Required function secrets:
//   RESEND_API_KEY, EMAIL_FROM, APP_URL  (already set for trial-code)
//   NEW_STUDENT_ALERT_TO  the inbox to tell. A secret rather than a constant
//                         because this repository is public.
// Auto-injected by the platform: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
import { corsHeaders } from "../_shared/http.ts";
import { admin } from "../_shared/clients.ts";
import { buildNewStudentEmail, type NewStudent } from "./email.ts";

/** Rows taken per call. More than a day's sign-ups. */
const BATCH = 20;
/** Emails an hour at most, so a burst of sign-ups can't drain the Resend quota trial codes share. */
const HOURLY_CAP = 30;
/** After this many tries a row is left alone. */
const MAX_ATTEMPTS = 5;
/** A claim this old belongs to a call that died; the next call may take the row. */
const CLAIM_TIMEOUT_MS = 10 * 60_000;

type Db = ReturnType<typeof admin>;

interface AlertRow {
  student_id: string;
  attempts: number;
}

/** Takes a row for this call. Compare-and-set on attempts, so two calls never both send. */
async function claim(db: Db, row: AlertRow): Promise<boolean> {
  const { data, error } = await db
    .from("new_student_alerts")
    .update({ claimed_at: new Date().toISOString(), attempts: row.attempts + 1 })
    .eq("student_id", row.student_id)
    .eq("attempts", row.attempts)
    .is("sent_at", null)
    .select("student_id");
  if (error) throw new Error(`new_student_alerts claim: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

async function loadStudent(db: Db, id: string): Promise<NewStudent | null> {
  const [{ data: profile, error: profileError }, { data: rows, error: rowsError }, auth] =
    await Promise.all([
      db
        .from("profiles")
        .select("display_name, level, exam_year, school, role")
        .eq("id", id)
        .maybeSingle(),
      db
        .from("student_enrolments")
        .select("subject, board, target_grade")
        .eq("student_id", id)
        .order("created_at"),
      db.auth.admin.getUserById(id),
    ]);
  if (profileError) throw new Error(`profiles read: ${profileError.message}`);
  if (rowsError) throw new Error(`student_enrolments read: ${rowsError.message}`);
  if (!profile || profile.role !== "student") return null;

  const user = auth.data?.user;
  return {
    id,
    name: profile.display_name,
    email: user?.email ?? null,
    level: profile.level,
    examYear: profile.exam_year,
    school: profile.school,
    provider: (user?.app_metadata?.provider as string | undefined) ?? null,
    subjects: (rows ?? []).map((r) => ({
      subject: r.subject,
      board: r.board,
      targetGrade: r.target_grade,
    })),
  };
}

async function send(to: string, from: string, appUrl: string, student: NewStudent) {
  const key = Deno.env.get("RESEND_API_KEY")!;
  const email = buildNewStudentEmail(student, appUrl);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], ...email }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function handle() {
  const to = Deno.env.get("NEW_STUDENT_ALERT_TO")?.trim();
  const from = Deno.env.get("EMAIL_FROM")?.trim();
  const appUrl = Deno.env.get("APP_URL")?.trim();
  if (!to || !from || !appUrl || !Deno.env.get("RESEND_API_KEY")) {
    // Nothing is claimed, so no attempt is used up: the rows wait for the secrets.
    console.error(
      "new-student-alert: NEW_STUDENT_ALERT_TO, EMAIL_FROM, APP_URL or RESEND_API_KEY not set",
    );
    return { sent: 0, failed: 0, waiting: true };
  }

  const db = admin();

  const { count, error: countError } = await db
    .from("new_student_alerts")
    .select("student_id", { count: "exact", head: true })
    .gt("sent_at", new Date(Date.now() - 3_600_000).toISOString());
  if (countError) throw new Error(`new_student_alerts count: ${countError.message}`);
  const room = Math.min(BATCH, HOURLY_CAP - (count ?? 0));
  if (room <= 0) return { sent: 0, failed: 0, waiting: true };

  const staleClaim = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
  const { data: due, error: dueError } = await db
    .from("new_student_alerts")
    .select("student_id, attempts")
    .is("sent_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .or(`claimed_at.is.null,claimed_at.lt."${staleClaim}"`)
    .order("created_at")
    .limit(room);
  if (dueError) throw new Error(`new_student_alerts read: ${dueError.message}`);

  let sent = 0;
  let failed = 0;
  for (const row of (due ?? []) as AlertRow[]) {
    if (!(await claim(db, row))) continue;
    try {
      const student = await loadStudent(db, row.student_id);
      // Gone or no longer a student: nothing to tell, and nothing to retry.
      if (student) await send(to, from, appUrl, student);
      const { error } = await db
        .from("new_student_alerts")
        .update({ sent_at: new Date().toISOString() })
        .eq("student_id", row.student_id);
      if (error) throw new Error(`new_student_alerts mark sent: ${error.message}`);
      if (student) sent++;
    } catch (err) {
      failed++;
      // No names or addresses in the log: the row's id is enough to find it.
      console.error(
        `new-student-alert: ${row.student_id} attempt ${row.attempts + 1}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return { sent, failed, waiting: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    return new Response(JSON.stringify(await handle()), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("new-student-alert:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Something went wrong." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
