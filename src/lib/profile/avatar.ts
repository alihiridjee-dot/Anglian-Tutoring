/**
 * Profile photo preparation.
 *
 * Every chosen file is re-encoded in the browser to a square JPEG before it
 * goes anywhere. That is not a size optimisation with a security side effect —
 * it is the other way round. Re-encoding through a canvas turns whatever was
 * chosen into pixels and drops everything else with it: no SVG carrying script,
 * no EXIF, and in particular no GPS coordinates riding along inside a
 * photograph of a child. The bucket then accepts only the `image/jpeg` this
 * produces.
 *
 * The size cap is the easy half. A phone photo lands at 2–5 MB and a 512px
 * square of it is tens of kilobytes, so the ladder below almost never gets past
 * its first rung — but a hostile 20-megapixel upload still can't get through.
 */

/** Bucket the photos live in. Private — reached only by a signed URL. */
export const AVATAR_BUCKET = "avatars";

/**
 * Lifetime of an avatar's signed URL, in seconds.
 *
 * Kept short on purpose. A signed URL is a bearer token: for as long as it
 * lives, anyone holding it can fetch the image without a session. It is only
 * ever minted into its owner's own browser, so five minutes is a narrow window
 * — but it is the window, and that is the reason not to widen it for the sake
 * of fewer round trips.
 */
export const AVATAR_URL_TTL_SECONDS = 300;

/**
 * Edge of the stored square, in pixels. The header renders it at 36px and the
 * profile preview at 80px, so 512 covers a 2× display with room to spare and
 * anything larger is bytes nobody sees.
 */
const AVATAR_EDGE = 512;

/** Hard ceiling, matching `file_size_limit` on the bucket. */
const AVATAR_MAX_BYTES = 1_048_576;

/** JPEG quality ladder, tried in order until the result fits. */
const QUALITY_STEPS = [0.86, 0.75, 0.62, 0.5];

/** What the file picker offers. The re-encode is what actually decides. */
export const AVATAR_ACCEPT = "image/*";

/** One photo per account, at a path the RLS policies pin to its owner. */
export function avatarObjectPath(userId: string): string {
  return `${userId}/avatar`;
}

export type PreparedAvatar = { ok: true; file: File } | { ok: false; reason: string };

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Decode, centre-crop to a square, scale to `AVATAR_EDGE` and encode as JPEG.
 *
 * Cropping to the centre rather than squashing to fit matters: the avatar is
 * displayed as a circle everywhere, and a letterboxed portrait photo squeezed
 * into a square comes out as a face nobody recognises.
 */
export async function prepareAvatar(file: File): Promise<PreparedAvatar> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, reason: "Choose an image file — a JPEG, PNG or WebP." };
  }

  let bitmap: ImageBitmap;
  try {
    // createImageBitmap applies EXIF orientation, so a photo taken sideways
    // isn't stored sideways.
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "That image could not be read. Try a JPEG or PNG." };
  }

  try {
    const edge = Math.min(bitmap.width, bitmap.height);
    const sx = Math.round((bitmap.width - edge) / 2);
    const sy = Math.round((bitmap.height - edge) / 2);
    // Never upscale: a 200px photo stays 200px rather than being blown up into
    // a blurry 512.
    const out = Math.min(AVATAR_EDGE, edge);

    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "That image could not be processed in this browser." };
    // JPEG has no alpha. Flatten onto white so a transparent PNG doesn't come
    // out on a black disc.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out, out);
    ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, out, out);

    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size <= AVATAR_MAX_BYTES) {
        return {
          ok: true,
          file: new File([blob], "avatar.jpg", {
            type: "image/jpeg",
            lastModified: Date.now(),
          }),
        };
      }
    }

    return { ok: false, reason: "That image is too detailed to store. Try a different photo." };
  } finally {
    bitmap.close();
  }
}
