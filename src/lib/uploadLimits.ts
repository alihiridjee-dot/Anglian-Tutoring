/**
 * Student homework upload limits.
 *
 * Submissions are almost always phone photos of handwritten work, which land at
 * 2–5 MB straight off the camera — well over the 1 MB cap. Rejecting those
 * outright would block most genuine submissions, so images are downscaled and
 * re-encoded in the browser first and only rejected if they still don't fit.
 *
 * The cap itself is enforced in the database by the
 * `enforce_submission_size_limit` trigger on `storage.objects`; this module is
 * the friendly front end to it, not the security boundary.
 */

export const MAX_UPLOAD_BYTES = 1_048_576; // 1 MB — must match the DB trigger.

/** Longest edge we'll keep. A4 handwriting stays legible well below this. */
const MAX_EDGE = 2000;
/** JPEG quality ladder, tried in order until the result fits. */
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.4];

export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  // createImageBitmap handles EXIF orientation for us on modern browsers.
  return await createImageBitmap(file);
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Shrink an image until it fits `MAX_UPLOAD_BYTES`, trying progressively lower
 * quality and then a smaller canvas. Returns the original file untouched if it
 * already fits, or if it isn't an image we can re-encode.
 */
async function compressImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return file; // Not decodable here — let the caller's size check reject it.
  }

  try {
    let edge = Math.min(MAX_EDGE, Math.max(bitmap.width, bitmap.height));

    // Two passes: quality ladder at full size, then halve the canvas and retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      const scale = edge / Math.max(bitmap.width, bitmap.height);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      // Photos of paper are white-backed; flatten any alpha to white rather
      // than black so PNG screenshots don't invert.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);

      for (const q of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, q);
        if (blob && blob.size <= MAX_UPLOAD_BYTES) {
          const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
        }
      }
      edge = Math.round(edge / 2);
    }
    return file;
  } finally {
    bitmap.close();
  }
}

export type PreparedUpload =
  | { ok: true; file: File; originalBytes: number; compressed: boolean }
  | { ok: false; file: File; reason: string };

/**
 * Get a chosen file ready to upload: compress images to fit, then enforce the
 * hard cap. Non-images (PDF, DOCX) can't be re-encoded safely, so they're
 * rejected with an actionable message rather than silently mangled.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const originalBytes = file.size;

  if (file.size <= MAX_UPLOAD_BYTES) {
    return { ok: true, file, originalBytes, compressed: false };
  }

  if (!isImage(file)) {
    return {
      ok: false,
      file,
      reason: `${file.name} is ${formatBytes(file.size)}. The limit is 1 MB — please compress it or split it up.`,
    };
  }

  const out = await compressImage(file);
  if (out.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      file,
      reason: `${file.name} is still ${formatBytes(out.size)} after compression. The limit is 1 MB — try cropping or photographing fewer pages at once.`,
    };
  }

  return { ok: true, file: out, originalBytes, compressed: out.size !== originalBytes };
}
