// The emails the delete-account function sends, one per stage and reader.
//
// Pure — no Deno, no network — so the wording is tested from bun
// (src/lib/students/accountDeletionEmails.test.ts) and the function only
// has to deliver it.

export type Audience = "student" | "parent" | "staff";
export type EmailKind = "scheduled" | "cancelled" | "completed";

/** One person to tell, captured when the deletion is booked. */
export interface Recipient {
  email: string;
  name: string | null;
  audience: Audience;
}

export interface EmailContext {
  /** How the student is named to parents and staff. */
  studentName: string;
  /** Shown to staff only, so they can tell two students of one name apart. */
  studentEmail: string | null;
  /** The day the account goes, already formatted. */
  purgeDate: string;
  /** Whether "undo" restarted a plan, which changes what a family is told. */
  planResumed?: boolean;
}

export interface Email {
  subject: string;
  text: string;
  html: string;
}

const BRAND = "Anglia Educate";

/** "30 September 2026", on UK time, whatever the server's zone. */
export function formatUkDate(when: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(when));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Paragraphs in, one plain-text and one HTML body out. */
function render(subject: string, paragraphs: string[]): Email {
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2333;max-width:560px">`,
    ...paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`),
    `<p style="margin:24px 0 0;color:#5b6475;font-size:13px">${BRAND}</p>`,
    `</div>`,
  ].join("");
  return { subject, text: [...paragraphs, BRAND].join("\n\n"), html };
}

export function buildEmail(kind: EmailKind, to: Recipient, ctx: EmailContext): Email {
  const hi = to.name?.trim() ? `Hi ${to.name.trim()},` : "Hi,";
  const { studentName: who, purgeDate: date } = ctx;

  if (to.audience === "staff") {
    const whoFull = ctx.studentEmail ? `${who} (${ctx.studentEmail})` : who;
    switch (kind) {
      case "scheduled":
        return render(`Deletion booked: ${who}`, [
          `${whoFull} will be deleted on ${date}.`,
          `They're locked out and their plan is paused. To stop it, open their record and press Undo before then.`,
        ]);
      case "cancelled":
        return render(`Deletion cancelled: ${who}`, [
          `${whoFull} is no longer being deleted. They can sign in again.`,
        ]);
      case "completed":
        return render(`Deleted: ${who}`, [
          `${whoFull}'s account and data have been deleted. Their plan is cancelled.`,
        ]);
    }
  }

  const own = to.audience === "student";
  const account = own ? "your account" : `${who}'s account`;
  const Account = own ? "Your account" : `${who}'s account`;

  switch (kind) {
    case "scheduled":
      return render(
        own
          ? `Your ${BRAND} account will be deleted on ${date}`
          : `${who}'s ${BRAND} account will be deleted on ${date}`,
        [
          hi,
          `${Account} is booked to be deleted on ${date}.`,
          own
            ? `You can't sign in from now on. Your plan is paused, so you won't be charged again.`
            : `${who} can't sign in from now on. The plan is paused, so there are no more charges.`,
          `On ${date} we'll delete ${account} and everything in it: work, marks, messages and billing details. After that it can't be brought back.`,
          ...(own ? [] : [`Your own account isn't affected.`]),
          `If this is a mistake, reply to this email before ${date}.`,
        ],
      );
    case "cancelled":
      return render(
        own
          ? `Your ${BRAND} account is no longer being deleted`
          : `${who}'s ${BRAND} account is no longer being deleted`,
        [
          hi,
          `We've cancelled the deletion of ${account}. ${own ? "You" : who} can sign in again.`,
          ...(ctx.planResumed ? [`The plan has restarted on the same terms as before.`] : []),
        ],
      );
    case "completed":
      return render(
        own
          ? `Your ${BRAND} account has been deleted`
          : `${who}'s ${BRAND} account has been deleted`,
        [
          hi,
          `${Account} has been deleted, along with ${own ? "your" : "their"} work, marks, messages and billing details. The plan has ended and there will be no more charges.`,
          `Our payment provider, Stripe, keeps a record of past payments, as the law requires.`,
          ...(own ? [] : [`Your own account isn't affected.`]),
          `Thank you for learning with us.`,
        ],
      );
  }
}
