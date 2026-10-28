/**
 * How much text each box takes, and what counts as a blank answer.
 *
 * The database refuses anything longer (supabase/migrations/
 * 20261028110000_size_and_flood_limits.sql), so each box stops at the same
 * length and a student never meets a raw database error. Every limit is far
 * above real use: a 6-mark answer is about 2,000 characters. The test beside
 * this file reads the migration, so the two can't drift apart.
 *
 * A box's maxLength counts UTF-16 units and the database counts characters,
 * which are never more, so a box at its limit always fits.
 */

/** One answer on a task sheet. */
export const ANSWER_MAX = 5000;
/** One chat message, to a tutor or back. */
export const CHAT_MESSAGE_MAX = 4000;
/** A display name, at sign-up or on the profile page. */
export const DISPLAY_NAME_MAX = 80;
/** A phone number as typed, spaces and brackets included. */
export const PHONE_MAX = 32;
/** A school's name. The longest on the UK list is 83. */
export const SCHOOL_MAX = 120;
/** The weekly note to the tutor. */
export const CHECKIN_NOTE_MAX = 2000;

/**
 * Spaces, line breaks and invisible formatting characters (zero-width spaces,
 * direction marks, byte-order marks): what `trim()` leaves behind that no
 * reader can see.
 */
const INVISIBLE = /[\s\p{Cf}]/gu;

/**
 * True when an answer holds nothing a reader can see. The server stores such
 * an answer as blank (submit_homework_answers), so the sheet counts it the
 * same way.
 */
export function isBlank(text: string | null | undefined): boolean {
  return !text || text.replace(INVISIBLE, "") === "";
}
