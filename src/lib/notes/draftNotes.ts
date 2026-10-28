/**
 * Drafted notes, read straight from scripts/notes while they are being written
 * and reviewed. Development only: the preview routes 404 in production.
 *
 * The glob sits behind `import.meta.env.DEV` so a production build drops it.
 * Lazy loading alone was not enough: every draft still became a public
 * /assets chunk, listed by path in the main bundle, so anyone could read every
 * revision note on the live site without signing in.
 *
 * `set` is the folder: "drafts" for the working copies, "trial/a" and
 * "trial/b" for a side-by-side comparison of two writers.
 */
import type { Note } from "./noteFormat";

const files: Record<string, () => Promise<Note>> = import.meta.env.DEV
  ? import.meta.glob<Note>("/scripts/notes/{drafts,trial}/**/*.json", { import: "default" })
  : {};

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
