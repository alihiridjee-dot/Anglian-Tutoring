/**
 * When the open conversation is marked read (mark_chat_thread_read).
 *
 * Each time it comes on screen, whatever its unread count. Tutors share one
 * read mark per thread, so a question to the whole team that one tutor has
 * read counts as read for the others too, while each of them still has their
 * own unread copy of it in the bell. Only the write clears that copy, and
 * waiting for an unread count left it lit.
 *
 * While it stays on screen, each new burst of unread is marked once: the poll's
 * refetch and StrictMode's second effect must not fire a second write.
 */
export type ReadMarks = {
  /** The thread on screen since its last mark: another look needs no write. */
  looking: string | null;
  /** The thread whose current burst of unread has been marked. */
  marked: string | null;
};

export const NO_READ_MARKS: ReadMarks = { looking: null, marked: null };

/** One look at a thread: whether to mark it read now, and what to remember. */
export function readMarkStep(
  prev: ReadMarks,
  threadId: string,
  unread: number,
  onScreen: boolean,
): { mark: boolean; next: ReadMarks } {
  const marked = unread > 0 && prev.marked === threadId ? threadId : null;
  if (!onScreen) return { mark: false, next: { looking: null, marked } };
  if (prev.looking === threadId && (unread === 0 || marked)) {
    return { mark: false, next: { looking: threadId, marked } };
  }
  return { mark: true, next: { looking: threadId, marked: unread > 0 ? threadId : null } };
}
