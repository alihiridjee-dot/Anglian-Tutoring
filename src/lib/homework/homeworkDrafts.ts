/**
 * Persistence for half-written homework answers, in two layers.
 *
 * Homework is answered on the page now, and long-answer questions mean a
 * student can have twenty minutes of typing on screen. All of it lived in React
 * state: a refresh, a crashed tab, a phone locking and the browser reclaiming
 * memory, or a stray navigation lost the lot with nothing to recover from. At
 * cohort scale that isn't a rare accident — with fifty students doing homework
 * on their own devices it is a weekly occurrence, and the work it loses is the
 * exact work the platform exists to collect.
 *
 * localStorage is the instant layer: it writes on a keystroke pause, survives a
 * crash, and works with no network. `homework_drafts` is the durable one: it
 * writes a little less often and is what carries a half-finished answer from
 * the school laptop to the phone on the bus home. Neither is authoritative on
 * its own, so {@link mergeDrafts} reconciles them question by question: each
 * answer (and the note) carries the time it was last edited, and the newer
 * edit of each wins. Whole drafts used to win or lose together, so a laptop
 * tab left open since yesterday blanked the answers typed on the phone with
 * its next keystroke, and a laptop that had been offline did the same when it
 * reconnected.
 *
 * Both are keyed per student and per homework, so two people sharing a laptop
 * never see each other's answers. Both are cleared once the submission lands
 * (the server's copy by `submit_homework_answers` itself), and the local one
 * expires on its own so an abandoned draft doesn't linger indefinitely.
 */
import { supabase } from "@/integrations/supabase/client";

const PREFIX = "anglia.hw-draft.v1";
/** Drafts older than this are discarded on read. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type StoredDraft = {
  savedAt: number;
  answers: Record<string, string>;
  notes: string;
  stamps?: Stamps;
};

export type HomeworkDraft = { answers: Record<string, string>; notes: string };

/**
 * When each answer was last edited, by question id, on this device's clock.
 * The note is under {@link NOTES}. A field with no stamp was never edited here.
 */
export type Stamps = Record<string, number>;

/** The key the note's edit time is kept under. Question ids are uuids, so it can't collide. */
export const NOTES = "notes";

/** A draft plus when it, and each answer in it, was written: how copies are reconciled. */
export type TimestampedDraft = HomeworkDraft & { savedAt: number; stamps: Stamps };

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
export function loadDraft(userId: string, homeworkId: string): TimestampedDraft | null {
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
      savedAt: parsed.savedAt ?? 0,
      answers: parsed.answers ?? {},
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
      stamps: parsed.stamps && typeof parsed.stamps === "object" ? parsed.stamps : {},
    };
  } catch {
    return null;
  }
}

/**
 * Persist a draft. An empty draft clears the entry rather than storing blanks,
 * unless it records an edit: an answer deliberately cleared must stay cleared.
 */
export function saveDraft(
  userId: string,
  homeworkId: string,
  draft: HomeworkDraft & { stamps?: Stamps },
): void {
  const store = available();
  if (!store) return;
  try {
    if (!hasContent(draft) && Object.keys(draft.stamps ?? {}).length === 0) {
      store.removeItem(key(userId, homeworkId));
      return;
    }
    const payload: StoredDraft = {
      savedAt: Date.now(),
      answers: draft.answers,
      notes: draft.notes,
      stamps: draft.stamps ?? {},
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

/** True if there is anything worth keeping — used to avoid storing blank drafts. */
function hasContent(draft: HomeworkDraft): boolean {
  return (
    draft.notes.trim().length > 0 || Object.values(draft.answers).some((v) => v.trim().length > 0)
  );
}

/**
 * The durable copy, for picking the work back up on another device.
 *
 * One call both ways: `sync_homework_draft` keeps the newer edit of each field
 * this device sends, and returns the whole merged draft, so the page can take
 * in what was typed elsewhere. Stamps travel with this device's clock reading,
 * which the server uses to convert them to its own time and back: two devices
 * whose clocks disagree still agree on which edit came last.
 *
 * Failures come back as null, on purpose. A draft is a safety net, and a net
 * that throws is worse than one with a hole in it: an offline student must keep
 * typing into a working page, backed by localStorage, rather than watch an
 * error toast every few seconds. Null also means "already handed in".
 */
export async function syncServerDraft(
  homeworkId: string,
  draft?: TimestampedDraft | null,
): Promise<TimestampedDraft | null> {
  try {
    const stamps = draft?.stamps ?? {};
    const { data, error } = await supabase.rpc("sync_homework_draft", {
      _resource_id: homeworkId,
      _answers: draft?.answers ?? {},
      _notes: NOTES in stamps ? (draft?.notes ?? "") : undefined,
      _stamps: stamps,
      _client_now: Date.now(),
    });
    if (error || !data) return null;
    const row = data as { answers?: Record<string, string>; notes?: string; stamps?: Stamps };
    return {
      savedAt: Math.max(0, ...Object.values(row.stamps ?? {})),
      answers: row.answers ?? {},
      notes: row.notes ?? "",
      stamps: row.stamps ?? {},
    };
  } catch {
    return null;
  }
}

/** When a draft's field was last edited. Unstamped fields date from the draft itself. */
function stampOf(draft: TimestampedDraft, field: string): number {
  const stamp = draft.stamps?.[field];
  if (typeof stamp === "number") return stamp;
  const present = field === NOTES ? draft.notes !== "" : field in draft.answers;
  return present ? draft.savedAt : -Infinity;
}

/**
 * Reconcile two copies of a draft, field by field: the newer edit of each
 * answer, and of the note, wins.
 *
 * The tie goes to `local`: if both were stamped in the same instant it is
 * because one copy produced the other, so they hold the same thing anyway.
 * Returns `local` itself when `server` adds nothing newer, so a caller holding
 * it in state can tell nothing changed.
 */
export function mergeDrafts(
  local: TimestampedDraft | null,
  server: TimestampedDraft | null,
): TimestampedDraft | null {
  if (!local) return server;
  if (!server) return local;

  let merged: TimestampedDraft | null = null;
  const take = () =>
    (merged ??= {
      ...local,
      answers: { ...local.answers },
      stamps: { ...local.stamps },
    });

  for (const field of new Set([
    ...Object.keys(server.answers),
    NOTES,
    ...Object.keys(server.stamps ?? {}),
  ])) {
    const theirs = stampOf(server, field);
    if (!(theirs > stampOf(local, field))) continue;
    // Newer, but the same words: nothing to take.
    if (field === NOTES) {
      if (server.notes === local.notes) continue;
      take().notes = server.notes;
    } else {
      if (!(field in server.answers) || server.answers[field] === local.answers[field]) continue;
      take().answers[field] = server.answers[field];
    }
    take().stamps[field] = theirs;
  }

  if (!merged) return local;
  const done = merged as TimestampedDraft;
  done.savedAt = Math.max(local.savedAt, server.savedAt);
  return done;
}
