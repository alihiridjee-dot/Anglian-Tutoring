/**
 * Task answers are typed, not pasted in. A student's answer box refuses
 * anything pasted or dropped into it, except words the student copied, cut or
 * dragged out of an answer box on the page: their own writing, which they may
 * move about as in any editor.
 *
 * The site can only refuse the paste. A student can still retype what they
 * read elsewhere; this stops the one-keystroke version of it.
 */
import type { ClipboardEvent, DragEvent } from "react";
import { toast } from "sonner";

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

type Box = HTMLTextAreaElement | HTMLInputElement;

// Words copied, cut or dragged out of a box are the student's own, and the
// one thing a box that refuses pastes still takes.
const own = (e: { currentTarget: Box }) => {
  const el = e.currentTarget;
  rememberOwnWords(el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
};
const refuse = (e: { preventDefault: () => void }, text: string) => {
  if (isOwnWords(text)) return;
  e.preventDefault();
  toast("Pasting is turned off on tasks — type your answer in your own words.", {
    id: "no-paste",
  });
};

/** What makes a student's box typed, not pasted in: spread onto its textarea or input. */
export const typedOnly = {
  onCopy: own,
  onCut: own,
  onDragStart: own,
  onPaste: (e: ClipboardEvent<Box>) => refuse(e, e.clipboardData.getData("text/plain")),
  onDrop: (e: DragEvent<Box>) => refuse(e, e.dataTransfer.getData("text/plain")),
};
