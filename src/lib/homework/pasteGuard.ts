/**
 * Task answers are typed, not pasted in. A student's answer box refuses
 * anything pasted or dropped into it, except words the student copied, cut or
 * dragged out of an answer box on the page: their own writing, which they may
 * move about as in any editor.
 *
 * The site can only refuse the paste. A student can still retype what they
 * read elsewhere; this stops the one-keystroke version of it.
 */

let ownWords: string | null = null;

/** What was just copied, cut or dragged out of an answer box. */
export function rememberOwnWords(text: string) {
  ownWords = text;
}

/** Whether text being pasted or dropped is the student's own, from an answer box. */
export function isOwnWords(text: string): boolean {
  return ownWords !== null && text !== "" && lineEnds(text) === lineEnds(ownWords);
}

// Windows puts \r\n on the clipboard for what a textarea holds as \n.
const lineEnds = (text: string) => text.replace(/\r\n?/g, "\n");
