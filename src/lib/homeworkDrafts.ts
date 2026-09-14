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
 * its own, so {@link mergeDrafts} takes whichever was written last — a student
 * who typed offline on their phone must not have it overwritten by the older
 * copy the server happens to be holding.
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
};

export type HomeworkDraft = { answers: Record<string, string>; notes: string };

/** A draft plus when it was written, which is how the two layers are reconciled. */
export type TimestampedDraft = HomeworkDraft & { savedAt: number };

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
    };
  } catch {
    return null;
  }
}

/** Persist a draft. An empty draft clears the entry rather than storing blanks. */
export function saveDraft(userId: string, homeworkId: string, draft: HomeworkDraft): void {
  const store = available();
  if (!store) return;
  try {
    if (!hasContent(draft)) {
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

/** True if there is anything worth keeping — used to avoid storing blank drafts. */
function hasContent(draft: HomeworkDraft): boolean {
  return (
    draft.notes.trim().length > 0 || Object.values(draft.answers).some((v) => v.trim().length > 0)
  );
}

/**
 * The durable copy, for picking the work back up on another device.
 *
 * Failures are swallowed on purpose. A draft is a safety net, and a net that
 * throws is worse than one with a hole in it: an offline student must keep
 * typing into a working page, backed by localStorage, rather than watch an
 * error toast every few seconds.
 */
export async function loadServerDraft(homeworkId: string): Promise<TimestampedDraft | null> {
  try {
    const { data, error } = await supabase
      .from("homework_drafts")
      .select("answers, notes, updated_at")
      .eq("resource_id", homeworkId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      savedAt: new Date(data.updated_at).getTime(),
      answers: (data.answers as Record<string, string> | null) ?? {},
      notes: data.notes ?? "",
    };
  } catch {
    return null;
  }
}

export async function saveServerDraft(
  userId: string,
  homeworkId: string,
  draft: HomeworkDraft,
): Promise<void> {
  try {
    if (!hasContent(draft)) {
      await supabase
        .from("homework_drafts")
        .delete()
        .eq("student_id", userId)
        .eq("resource_id", homeworkId);
      return;
    }
    await supabase.from("homework_drafts").upsert(
      {
        student_id: userId,
        resource_id: homeworkId,
        answers: draft.answers,
        notes: draft.notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,resource_id" },
    );
  } catch {
    /* best-effort — localStorage still holds it */
  }
}

/**
 * Reconcile the two layers.
 *
 * Last write wins, and the tie goes to the local copy: if both were saved in
 * the same instant it is because the local write is the one that produced the
 * server write, so they hold the same thing anyway.
 */
export function mergeDrafts(
  local: TimestampedDraft | null,
  server: TimestampedDraft | null,
): TimestampedDraft | null {
  if (!local) return server;
  if (!server) return local;
  return server.savedAt > local.savedAt ? server : local;
}
