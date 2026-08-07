import { createResourceSignedUrls } from "@/lib/storage.functions";

/**
 * One batched, cached, self-renewing source of signed URLs for the private
 * `resources` bucket.
 *
 * Two problems, both of which only show up with a page full of images or a
 * cohort of students on it at once:
 *
 *  1. **A request per image.** Every `SignedImage` signed its own path on
 *     mount. Forty figures on a homework page is forty server-function calls,
 *     each building a Supabase client and validating the JWT before it can do
 *     the one thing being asked. Mounts inside the same tick are collected here
 *     and sent as a single request instead.
 *
 *  2. **Links that go stale while you're reading.** Signed URLs last five
 *     minutes. A student working through a long homework page passes that
 *     easily, and the images then break with no way back except a reload — on
 *     the very page where a reload used to cost them their answers. Entries are
 *     re-signed shortly before they expire, so a page left open keeps working.
 *
 * Short-lived links are still the right call for student work; the fix is to
 * renew them, not to mint long-lived ones.
 */

/** Requests that arrive within this window are sent together. */
const COALESCE_MS = 16;
/** Re-sign this long before expiry, so a render never lands on a dead URL. */
const REFRESH_MARGIN_MS = 45_000;
/** Matches the batch endpoint's own cap. */
const MAX_BATCH = 50;

type Entry = { url: string; expiresAt: number };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<string | null>>();

let pending: string[] = [];
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResolvers: Array<() => void> = [];

function fresh(path: string): string | null {
  const hit = cache.get(path);
  if (!hit) return null;
  if (hit.expiresAt - REFRESH_MARGIN_MS <= Date.now()) {
    cache.delete(path);
    return null;
  }
  return hit.url;
}

async function flush(): Promise<void> {
  const paths = pending;
  const resolvers = pendingResolvers;
  pending = [];
  pendingResolvers = [];
  pendingTimer = null;
  if (paths.length === 0) return;

  try {
    for (let i = 0; i < paths.length; i += MAX_BATCH) {
      const slice = paths.slice(i, i + MAX_BATCH);
      const { urls, expiresIn } = await createResourceSignedUrls({
        data: { paths: slice },
      });
      const expiresAt = Date.now() + expiresIn * 1000;
      for (const [path, url] of Object.entries(urls)) {
        if (url) cache.set(path, { url, expiresAt });
      }
    }
  } finally {
    // Wake every waiter regardless — a failed batch resolves to null rather
    // than leaving components spinning forever.
    for (const done of resolvers) done();
  }
}

/**
 * The signed URL for `path`, from cache when it's still good.
 *
 * Concurrent callers for the same path share one request, and callers in the
 * same tick share one batch.
 */
export function getSignedUrl(path: string): Promise<string | null> {
  const cached = fresh(path);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(path);
  if (existing) return existing;

  const request = new Promise<void>((resolve) => {
    pending.push(path);
    pendingResolvers.push(resolve);
    pendingTimer ??= setTimeout(() => void flush(), COALESCE_MS);
  }).then(() => {
    inFlight.delete(path);
    return fresh(path);
  });

  inFlight.set(path, request);
  return request;
}

/** How long until this path's cached URL needs re-signing, or null if absent. */
export function msUntilRefresh(path: string): number | null {
  const hit = cache.get(path);
  if (!hit) return null;
  return Math.max(0, hit.expiresAt - REFRESH_MARGIN_MS - Date.now());
}

/** Drop everything — used on sign-out, so one user's links never outlive them. */
export function clearSignedUrlCache(): void {
  cache.clear();
  inFlight.clear();
}
