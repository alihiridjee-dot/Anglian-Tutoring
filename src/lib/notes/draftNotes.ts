/**
 * Drafted notes, read straight from scripts/notes while they are being written
 * and reviewed. Development only: the preview routes 404 in production, and
 * the files load lazily so none of them ship in the main bundle.
 *
 * `set` is the folder: "drafts" for the working copies, "trial/a" and
 * "trial/b" for a side-by-side comparison of two writers.
 */
import type { Note } from "./noteFormat";

const files = import.meta.glob<Note>("/scripts/notes/{drafts,trial}/**/*.json", {
  import: "default",
});

export interface DraftRef {
  set: string;
  subject: string;
  conceptId: string;
  load: () => Promise<Note>;
}

export const draftNotes: DraftRef[] = Object.entries(files).map(([path, load]) => {
  const m = path.match(/^\/scripts\/notes\/(drafts|trial\/[^/]+)\/([^/]+)\/([^/]+)\.json$/);
  return { set: m?.[1] ?? "?", subject: m?.[2] ?? "?", conceptId: m?.[3] ?? path, load };
});

export const findDraft = (set: string, conceptId: string) =>
  draftNotes.find((d) => d.set === set && d.conceptId === conceptId);
