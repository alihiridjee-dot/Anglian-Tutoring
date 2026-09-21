import { type LiveSession } from "./liveSessions";

/** A wa.me link that opens the student's own chat with the session details pre-filled. */
export const whatsAppShareLink = (s: LiveSession, phonePrefix: string, phoneNumber: string) => {
  const timeStr = s.starts_at ? new Date(s.starts_at).toLocaleString() : "";
  const text = `📚 *Anglia Educate Live Session Reminder* 📚\n\nI have an upcoming live session scheduled:\n\n🔹 *Session:* ${s.title}\n🔹 *Subject:* ${s.subject.toUpperCase()} (${s.level.toUpperCase()})\n🔹 *Time:* ${timeStr}\n\n👉 *Join link:* ${s.join_url || "Link pending"}\n\nSee you there!`;
  const cleanPhone = `${phonePrefix.replace("+", "")}${phoneNumber.replace(/[^0-9]/g, "")}`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
};

/** A wa.me link with no recipient, for sharing the invite with a study group. */
export const whatsAppGroupShareLink = (s: LiveSession) => {
  const timeStr = s.starts_at ? new Date(s.starts_at).toLocaleString() : "";
  const text = `📚 *Anglia Educate Live Session Invite* 📚\n\nHey everyone! Join the live tutoring session:\n\n🔹 *Session:* ${s.title}\n🔹 *Subject:* ${s.subject.toUpperCase()} (${s.level.toUpperCase()})\n🔹 *Time:* ${timeStr}\n\n👉 *Join here:* ${s.join_url || "Link pending"}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
};
