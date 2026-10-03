/**
 * Keeps a half-finished quiz's answers across a reload.
 *
 * The chosen options lived in React state alone, so a refresh, a phone that
 * locked and reclaimed the tab, or a stray swipe back wiped a twenty-question
 * quiz at question nineteen. Homework has had drafts for this reason since it
 * moved on-page (`@/lib/homework/homeworkDrafts`); a quiz is lighter — a few integers,
 * with nothing worth carrying between devices — so it gets the light version.
 *
 * sessionStorage, not localStorage: it survives the reload, which is the
 * accident, and dies with the tab, which is what a shared school laptop wants.
 * Keyed per user and per set regardless, so two students using one tab in turn
 * never meet each other's answers.
 */

const PREFIX = "anglia.mcq-answers.v1";

export type McqAnswers = Record<string, number>;

function key(userId: string, setId: string): string {
  return `${PREFIX}:${userId}:${setId}`;
}

function available(): Storage | null {
  // Safari in private mode throws on access rather than returning null.
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Drop anything that no longer fits the paper in front of the student.
 *
 * A tutor can edit a set between the save and the reload. An answer for a
 * question that has gone, or an option index the question no longer has, would
 * count towards "all answered" while pointing at nothing.
 */
export function reconcileAnswers(
  saved: unknown,
  questions: readonly { id: string; options: readonly unknown[] }[],
): McqAnswers {
  if (!saved || typeof saved !== "object") return {};
  const source = saved as Record<string, unknown>;
  const kept: McqAnswers = {};
  for (const q of questions) {
    const choice = source[q.id];
    if (
      typeof choice === "number" &&
      Number.isInteger(choice) &&
      choice >= 0 &&
      choice < q.options.length
    ) {
      kept[q.id] = choice;
    }
  }
  return kept;
}

export function loadMcqAnswers(userId: string, setId: string): unknown {
  const store = available();
  if (!store) return null;
  try {
    const raw = store.getItem(key(userId, setId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persist the answers so far. An empty set clears the entry instead. */
export function saveMcqAnswers(userId: string, setId: string, answers: McqAnswers): void {
  const store = available();
  if (!store) return;
  try {
    if (Object.keys(answers).length === 0) store.removeItem(key(userId, setId));
    else store.setItem(key(userId, setId), JSON.stringify(answers));
  } catch {
    // Best-effort: a full or disabled store must never break the click that
    // triggered it.
  }
}

/**
 * The id this attempt will be filed under, made here rather than by the server.
 *
 * When a submission's reply was lost, the page asked the student to submit
 * again, and the server filed a second attempt: the planner then counted one
 * sitting as two. With the id fixed before the first submit, a retry sends the
 * same id, and `grade_mcq_attempt` returns the attempt it already filed. Kept
 * beside the answers so a reload after the lost reply still retries with it.
 * Storage that won't hold it only costs the reload case: the caller keeps the
 * id it was given for as long as the page is open.
 */
export function attemptIdFor(userId: string, setId: string): string {
  const store = available();
  const k = `${key(userId, setId)}:attempt`;
  try {
    const saved = store?.getItem(k);
    if (saved) return saved;
  } catch {
    /* fall through to a fresh id */
  }
  const id = crypto.randomUUID();
  try {
    store?.setItem(k, id);
  } catch {
    /* best-effort, as above */
  }
  return id;
}

/** Remove the saved answers, and the attempt's id, once the paper has actually been marked. */
export function clearMcqAnswers(userId: string, setId: string): void {
  const store = available();
  if (!store) return;
  try {
    store.removeItem(key(userId, setId));
    store.removeItem(`${key(userId, setId)}:attempt`);
  } catch {
    /* nothing to do */
  }
}
