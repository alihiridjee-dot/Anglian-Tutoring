import type { SubjectV } from "@/lib/taxonomy";

/**
 * What a new question is attached to, while it is still being composed.
 *
 * Shared by the picker that produces it and the dialog that submits it, so it
 * lives apart from either. Once the thread is created this shape is gone — the
 * database stores the id in its own typed column plus a `context_label`
 * snapshot; see `ChatContextKind` in `@/lib/chatDal` for the persisted side.
 *
 * At most one id is ever set, matching the `chat_threads_single_context` check
 * constraint. `label` is carried alongside so the thread can record what it was
 * about without a second lookup.
 */
export type ChatContextSelection = {
  kind: "general" | "spec_point" | "homework" | "mcq_set";
  specPointId?: string;
  resourceId?: string;
  mcqSetId?: string;
  subject?: SubjectV | null;
  label?: string;
};

/** No attachment — a plain question. */
export const EMPTY_CONTEXT: ChatContextSelection = { kind: "general" };
