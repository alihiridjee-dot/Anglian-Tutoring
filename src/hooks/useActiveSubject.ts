import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useEnrolments } from "@/hooks/data/useEnrolments";

/**
 * The subject a student is looking at, chosen once in the header.
 *
 * Every student page used to keep its own subject — Homework and MCQs each
 * remembered one under their own key, the Curriculum started on Biology, the
 * planner on whichever subject sorted first — so the same student could be on
 * Chemistry homework and Biology quizzes at once with nothing on screen saying
 * so. Now the header slider writes one choice and every page reads it.
 *
 * Remembered per device, so the app reopens where it was left. Deliberately not
 * synced between open tabs: a tab flipping subject under someone mid-quiz
 * because of a click in another window would be the bigger surprise.
 */
const KEY = "active-subject";

const listeners = new Set<() => void>();
/** `undefined` until storage has been read once. */
let stored: string | null | undefined;

function read(): string | null {
  if (stored === undefined) {
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      // Private browsing, or storage refused: start from the first subject.
      stored = null;
    }
  }
  return stored;
}

function write(next: string) {
  if (next === stored) return;
  stored = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Remembering is a convenience; the choice still holds for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface ActiveSubject {
  /**
   * The chosen subject if the student sits it, otherwise their first. Null only
   * while the profile loads, or for someone with no subjects.
   */
  subject: string | null;
  /** The student's subjects, in the order the slider shows them. */
  subjects: string[];
  setSubject: (subject: string) => void;
  loading: boolean;
}

export function useActiveSubject(): ActiveSubject {
  const { enrolledCourses, loading } = useEnrolments();
  const remembered = useSyncExternalStore(subscribe, read, () => null);
  // A remembered subject the student no longer sits (dropped from the plan,
  // another account on this device) falls back rather than showing nothing.
  const subject =
    remembered && enrolledCourses.includes(remembered) ? remembered : (enrolledCourses[0] ?? null);
  const setSubject = useCallback((next: string) => write(next), []);
  return { subject, subjects: enrolledCourses, setSubject, loading };
}

/**
 * For a page reached by a link that names a subject (`?subject=` from global
 * search, a curriculum point, the planner). The slider moves onto it, then
 * `clear` drops the parameter: from there the slider decides, and a stale one
 * would pull a reload back to it.
 *
 * A subject the student doesn't sit isn't on the slider, so the link's subject
 * is left alone (and left in the URL) — pass null to opt out, e.g. for a tutor.
 */
export function useSubjectFromLink(linkSubject: string | null | undefined, clear: () => void) {
  const { subjects, setSubject } = useActiveSubject();
  const clearRef = useRef(clear);
  clearRef.current = clear;

  useEffect(() => {
    if (!linkSubject || !subjects.includes(linkSubject)) return;
    setSubject(linkSubject);
    clearRef.current();
  }, [linkSubject, subjects, setSubject]);
}

/**
 * For a page that belongs to one subject — a homework sheet, a quiz.
 *
 * Opening it moves the header slider to that subject, so the header never names
 * a subject the page isn't about. Moving the slider away afterwards calls
 * `onLeave`, which should go back to the section's list (now showing the new
 * subject) — a Chemistry quiz can't become a Biology one.
 *
 * A subject the student doesn't sit isn't on the slider, so the page is left
 * alone: there is nothing to move the slider to, and nothing to leave.
 */
export function usePinSubject(pageSubject: string | null | undefined, onLeave: () => void) {
  const { subject, subjects, setSubject } = useActiveSubject();
  const pinned = useRef<string | null>(null);
  const leave = useRef(onLeave);
  leave.current = onLeave;

  useEffect(() => {
    if (!pageSubject || !subjects.includes(pageSubject)) return;
    if (pinned.current !== pageSubject) {
      pinned.current = pageSubject;
      setSubject(pageSubject);
      return;
    }
    if (subject && subject !== pageSubject) leave.current();
  }, [pageSubject, subjects, subject, setSubject]);
}
