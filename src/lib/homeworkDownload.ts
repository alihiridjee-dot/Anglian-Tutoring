import { zip } from "fflate";
import { createResourceSignedUrl } from "@/lib/storage.functions";

/**
 * Bulk download for homework submissions.
 *
 * Files live in the private `resources` bucket, so each one has to be signed
 * before it can be fetched. We sign + fetch the bytes in the browser and zip
 * them client-side: the submissions never pass through a third party, and
 * authorization stays exactly where it already is (Storage RLS, via
 * `createResourceSignedUrl`).
 */

export type DownloadFile = { path: string; name: string };

/** One file, plus the folder it should land in inside the archive. */
export type ZipEntry = { folder: string; file: DownloadFile };

/** How many files to sign+fetch at once. Keeps big batches off a single stall. */
const CONCURRENCY = 4;

/** Strip path separators and control characters so a name can't escape its folder. */
function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[/\\<>:"|?*\x00-\x1f]/g, "_").trim() || "file";
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const { url } = await createResourceSignedUrl({ data: { path } });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Hand a blob to the browser as a download. */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Run `worker` over `items`, at most CONCURRENCY at a time. */
async function mapLimit<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

export type ZipResult = { zipped: number; failed: string[] };

/**
 * Fetch every entry and deliver them as one .zip.
 *
 * Individual failures are collected rather than thrown, so one unreadable file
 * can't cost the tutor the whole batch. Throws only if nothing could be fetched.
 */
export async function downloadEntriesAsZip(
  entries: ZipEntry[],
  zipName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ZipResult> {
  if (entries.length === 0) throw new Error("Nothing selected to download");

  const tree: Record<string, Uint8Array> = {};
  const failed: string[] = [];
  let done = 0;

  await mapLimit(entries, async (entry) => {
    try {
      const bytes = await fetchBytes(entry.file.path);
      const folder = safeName(entry.folder);
      const base = safeName(entry.file.name);
      // Two students can submit "answers.pdf"; folders keep those apart, but a
      // single student re-uploading the same name would still collide.
      let key = `${folder}/${base}`;
      for (let n = 2; key in tree; n++) {
        const dot = base.lastIndexOf(".");
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext = dot > 0 ? base.slice(dot) : "";
        key = `${folder}/${stem} (${n})${ext}`;
      }
      tree[key] = bytes;
    } catch {
      failed.push(entry.file.name);
    } finally {
      onProgress?.(++done, entries.length);
    }
  });

  const zipped = Object.keys(tree).length;
  if (zipped === 0) throw new Error("None of the selected files could be downloaded");

  const data = await new Promise<Uint8Array>((resolve, reject) => {
    // level 0 (store): homework is PDF/JPEG/PNG/DOCX, all already compressed —
    // re-deflating them burns CPU for ~nothing.
    zip(tree, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)));
  });

  triggerDownload(new Blob([data as BlobPart], { type: "application/zip" }), zipName);
  return { zipped, failed };
}

/** Download a single file under its original name (no zip). */
export async function downloadSingleFile(file: DownloadFile): Promise<void> {
  const bytes = await fetchBytes(file.path);
  triggerDownload(new Blob([bytes as BlobPart]), safeName(file.name));
}
