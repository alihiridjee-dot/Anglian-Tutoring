import { scrubForModel } from "@/lib/search/help";

/**
 * The chat on the back of a tutor's card on the home page (TutorsSection.tsx).
 *
 * A parent's first few messages are answered on the spot by an AI writing as
 * that tutor (tutorChat.functions.ts). After `AI_REPLIES` answers the chat
 * hands over to WhatsApp, taking the parent's questions with it, so the real
 * tutor picks up where the conversation left off.
 *
 * Shared by the card and the server, so both count turns the same way.
 */

export type TutorId = "nadia" | "ali";

export const TUTOR_IDS: readonly TutorId[] = ["nadia", "ali"];

/** One message in the chat. `tutor` turns are the AI's earlier replies. */
export type ChatTurn = { from: "parent" | "tutor"; text: string };

/** How many of a parent's messages the AI answers before handing over to WhatsApp. */
export const AI_REPLIES = 3;

/** Longest message a parent can send. A question, not an essay. */
export const MAX_MESSAGE = 500;

/** Longest earlier reply sent back as context; the model is told to write far less. */
const MAX_REPLY = 800;

/**
 * Checks what the card sends before any of it reaches the model. The
 * conversation must start and end with the parent, take turns, and hold no
 * more than `AI_REPLIES` parent messages. The parent's words lose any email
 * address or phone number first.
 */
export function validateTutorChat(input: unknown): { tutor: TutorId; turns: ChatTurn[] } {
  const raw = (input ?? {}) as { tutor?: unknown; turns?: unknown };
  const tutor = TUTOR_IDS.find((id) => id === raw.tutor);
  if (!tutor) throw new Error("Unknown tutor");
  if (!Array.isArray(raw.turns) || raw.turns.length === 0) throw new Error("Type a question first");
  if (raw.turns.length > AI_REPLIES * 2 - 1) {
    throw new Error("Let's carry on over on WhatsApp.");
  }

  const turns = raw.turns.map((t, i): ChatTurn => {
    const turn = (t ?? {}) as { from?: unknown; text?: unknown };
    const from = i % 2 === 0 ? "parent" : "tutor";
    if (turn.from !== from) throw new Error("Messages out of order");
    const text = String(turn.text ?? "");
    return {
      from,
      text: from === "parent" ? scrubForModel(text, MAX_MESSAGE) : text.trim().slice(0, MAX_REPLY),
    };
  });
  if (turns[turns.length - 1].from !== "parent") throw new Error("Type a question first");
  if (turns.some((t) => !t.text)) throw new Error("Type a question first");
  return { tutor, turns };
}

/**
 * The message WhatsApp opens with: the same greeting as ever, then whatever
 * the parent asked on the card, so the tutor can see what was asked.
 */
export function handoffText(firstName: string, questions: string[], draft = ""): string {
  const asked = [...questions, draft].map((q) => q.trim()).filter(Boolean);
  const hello = `Hi ${firstName}! I saw your profile on the Anglia Educate site.`;
  if (asked.length === 0) return hello;
  if (asked.length === 1) return `${hello}\n\n${asked[0]}`;
  return `${hello} Carrying on from our chat there:\n\n${asked.map((q) => `• ${q}`).join("\n")}`;
}

/**
 * The model's reply as plain chat text. It is told not to use markdown; this
 * removes any that slips through, so a parent never sees stray asterisks.
 */
export function cleanReply(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*(?:[-*•]|#+)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REPLY);
}
