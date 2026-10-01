import { type LiveSession } from "./liveSessions";
import { levelLabel, subjectLabel } from "@/lib/curriculum/courseSummary";
import { PLANNER_TIME_ZONE } from "@/lib/planner/week";

type SessionText = Pick<LiveSession, "title" | "subject" | "level" | "starts_at" | "join_url">;

/**
 * "Thu 17 Jul, 16:00 (UK time)" (the joint varies by browser). Sessions run on
 * UK time, and this text is read on someone else's phone: the sender's own
 * clock and zone told a student abroad the wrong hour, with nothing to say so.
 */
export function ukSessionTime(startsAt: string | null): string {
  const d = startsAt ? new Date(startsAt) : null;
  if (!d || isNaN(d.getTime())) return "";
  const when = d.toLocaleString("en-GB", {
    timeZone: PLANNER_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${when} (UK time)`;
}

/** "Biology · GCSE Combined Science (Trilogy)", not "BIOLOGY (GCSE_TRILOGY)". */
const courseLine = (s: Pick<SessionText, "subject" | "level">) =>
  `${subjectLabel(s.subject)} · ${levelLabel(s.level) ?? s.level}`;

/**
 * The digits wa.me wants: the country code, then the national number without
 * its leading 0, so "07123 456789" at +44 is 447123456789 (wa.me/4407… is not a
 * number). Null when nothing but spaces was typed.
 */
export function whatsAppNumber(phonePrefix: string, phoneNumber: string): string | null {
  const national = phoneNumber.replace(/\D/g, "").replace(/^0+/, "");
  if (!national) return null;
  return `${phonePrefix.replace(/\D/g, "")}${national}`;
}

/**
 * A wa.me link that opens the student's own chat with the session details
 * pre-filled, or null until a number has been typed.
 */
export const whatsAppShareLink = (s: SessionText, phonePrefix: string, phoneNumber: string) => {
  const phone = whatsAppNumber(phonePrefix, phoneNumber);
  if (!phone) return null;
  const text = `📚 *Anglia Educate Live Session Reminder* 📚\n\nI have an upcoming live session scheduled:\n\n🔹 *Session:* ${s.title}\n🔹 *Subject:* ${courseLine(s)}\n🔹 *Time:* ${ukSessionTime(s.starts_at)}\n\n👉 *Join link:* ${s.join_url || "Link pending"}\n\nSee you there!`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
};

/** A wa.me link with no recipient, for sharing the invite with a study group. */
export const whatsAppGroupShareLink = (s: SessionText) => {
  const text = `📚 *Anglia Educate Live Session Invite* 📚\n\nHey everyone! Join the live tutoring session:\n\n🔹 *Session:* ${s.title}\n🔹 *Subject:* ${courseLine(s)}\n🔹 *Time:* ${ukSessionTime(s.starts_at)}\n\n👉 *Join here:* ${s.join_url || "Link pending"}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
};

/** The invite a tutor pastes into the WhatsApp group after scheduling a session. */
export const scheduledInviteText = (s: SessionText) =>
  `📚 *New Anglia Educate Live Session Scheduled!* 📚\n\n🔹 *Session:* ${s.title}\n🔹 *Subject:* ${courseLine(s)}\n🔹 *Time:* ${ukSessionTime(s.starts_at)}\n\n👉 *Join here:* ${s.join_url || "Link pending"}`;
