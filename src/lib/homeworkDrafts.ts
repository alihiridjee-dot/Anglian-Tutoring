/**
 * Local persistence for half-written homework answers.
 *
 * Homework is answered on the page now, and long-answer questions mean a
 * student can have twenty minutes of typing on screen. All of it lived in React
 * state: a refresh, a crashed tab, a phone locking and the browser reclaiming
 * memory, or a stray navigation lost the lot with nothing to recover from. At
 * cohort scale that isn't a rare accident — with fifty students doing homework
 * on their own devices it is a weekly occurrence, and the work it loses is the
 * exact work the platform exists to collect.
 *
 * Drafts are written to localStorage as the student types, keyed per student
 * and per homework so two people sharing a laptop never see each other's
 * answers. They're cleared once the submission lands, and expire on their own
 * so an abandoned draft doesn't linger indefinitely.
 *
 * Text only. Attached photos are File objects that cannot be serialised, and
 * the student still has to re-pick those — the answers are what matters.
 */

const PREFIX = "anglia.hw-draft.v1";
/** Drafts older than this are discarded on read. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type StoredDraft = {
  savedAt: number;
  answers: Record<string, string>;
  notes: string;
};

export type HomeworkDraft = { answers: Record<string, string>; notes: string };

function key(userId: string, homeworkId: string): string {
  return `${PREFIX}:${userId}:${homeworkId}`;
}

function available(): Storage | null {
  // Safari in private mode throws on access rather than returning null, and a
  // draft that can't be saved must never break the page it's saving.
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The saved draft for this student's homework, or null if there isn't a usable one. */
export function loadDraft(userId: string, homeworkId: string): HomeworkDraft | null {
  const store = available();
  if (!store) return null;
  try {
    const raw = store.getItem(key(userId, homeworkId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - (parsed.savedAt ?? 0) > MAX_AGE_MS) {
      store.removeItem(key(userId, homeworkId));
      return null;
    }
    return {
      answers: parsed.answers ?? {},
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch {
    return null;
  }
}

/** Persist a draft. An empty draft clears the entry rather than storing blanks. */
export function saveDraft(userId: string, homeworkId: string, draft: HomeworkDraft): void {
  const store = available();
  if (!store) return;
  const hasContent =
    draft.notes.trim().length > 0 || Object.values(draft.answers).some((v) => v.trim().length > 0);
  try {
    if (!hasContent) {
      store.removeItem(key(userId, homeworkId));
      return;
    }
    const payload: StoredDraft = {
      savedAt: Date.now(),
      answers: draft.answers,
      notes: draft.notes,
    };
    store.setItem(key(userId, homeworkId), JSON.stringify(payload));
  } catch {
    // Quota exceeded, or storage disabled. A draft is best-effort — losing the
    // backup is bad, but throwing here would break the keystroke that triggered
    // it, which is worse.
  }
}

/** Remove a draft once its homework has actually been handed in. */
export function clearDraft(userId: string, homeworkId: string): void {
  const store = available();
  if (!store) return;
  try {
    store.removeItem(key(userId, homeworkId));
  } catch {
    /* nothing to do */
  }
}

/** Drop every draft belonging to any user — used on sign-out. */
export function clearAllDrafts(): void {
  const store = available();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    /* nothing to do */
  }
}
