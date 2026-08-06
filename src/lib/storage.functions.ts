import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Signed-URL issuance for the private `resources` bucket.
 *
 * Every homework artefact — tutor task briefs, mark schemes, and student
 * submissions — lives in a single PRIVATE Storage bucket, so the bytes are
 * never publicly reachable. To view a file the client must request a
 * short-lived signed URL from the server.
 *
 * Authorization is enforced by Row-Level Security, not by ad-hoc checks here:
 * `requireSupabaseAuth` builds a Supabase client bound to the caller's JWT, so
 * `createSignedUrl` runs under the caller's identity and the existing
 * `storage.objects` "resources bucket read scoped" policy decides access
 * (tutors/admins → all; students → their own `submissions/{uid}/…` plus files
 * for subjects they're enrolled in; parents → their linked child's). A caller
 * who passes a path they cannot read simply gets an RLS denial, so raw paths
 * are safe to accept.
 */

const BUCKET = "resources";
const DEFAULT_TTL = 300; // 5 minutes
const MIN_TTL = 30;
const MAX_TTL = 3600; // 1 hour

type SignInput = {
  /** Object path within the `resources` bucket, e.g. `submissions/{uid}/{hw}/file.pdf`. */
  path: string;
  /** Signed-URL lifetime in seconds. Clamped to [30, 3600]. */
  expiresIn?: number;
  /**
   * When set, the browser is told to download rather than render inline. Pass a
   * string to override the saved filename; `true` uses the object's own name.
   */
  download?: boolean | string;
};

function cleanPath(raw: unknown): string {
  const path = typeof raw === "string" ? raw.trim() : "";
  if (!path) throw new Error("A file path is required");
  // Guard against absolute paths and traversal; RLS is the real gate, this
  // just rejects obviously malformed input before hitting Storage.
  if (path.startsWith("/") || path.includes("..")) {
    throw new Error("Invalid file path");
  }
  return path;
}

function cleanTtl(raw: unknown): number {
  const ttl = Number(raw);
  return Number.isFinite(ttl) ? Math.min(Math.max(ttl, MIN_TTL), MAX_TTL) : DEFAULT_TTL;
}

export const createResourceSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SignInput) => ({
    path: cleanPath(input?.path),
    expiresIn: cleanTtl(input?.expiresIn),
    download: input?.download ?? false,
  }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: signed, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(data.path, data.expiresIn, { download: data.download });

    if (error || !signed?.signedUrl) {
      // A missing object and an RLS denial both surface here; keep the message
      // generic so we don't leak whether a given path exists.
      throw new Error("File not found or access denied");
    }

    return { url: signed.signedUrl, expiresIn: data.expiresIn };
  });

/** Most paths one request may sign. Keeps a single call bounded. */
const MAX_BATCH = 50;

/**
 * Sign many paths in one request.
 *
 * Question figures and photos of working are part of the page, so every
 * `SignedImage` resolved its own URL on mount — one server function call each,
 * and each one builds a fresh Supabase client and validates the caller's JWT
 * before it can do anything. A homework page with eight briefs of five
 * illustrated questions is forty of those on a single mount; a cohort opening
 * homework at the same time turns that into thousands of concurrent
 * authentications for what is really one question: sign these files for this
 * student.
 *
 * `createSignedUrls` answers it in one round trip, under one identity check.
 * Authorization is unchanged — the same RLS policy decides each path, and
 * anything the caller may not read simply comes back with a null url rather
 * than failing the batch, so one inaccessible file can't blank a whole page.
 */
export const createResourceSignedUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { paths: string[]; expiresIn?: number }) => {
    const raw = Array.isArray(input?.paths) ? input.paths : [];
    if (raw.length === 0) throw new Error("At least one file path is required");
    if (raw.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} files per request`);
    // De-duplicate: the same figure often appears on several cards at once.
    return {
      paths: [...new Set(raw.map(cleanPath))],
      expiresIn: cleanTtl(input?.expiresIn),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: signed, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(data.paths, data.expiresIn);

    if (error) throw new Error("File not found or access denied");

    const urls: Record<string, string | null> = {};
    for (const p of data.paths) urls[p] = null;
    for (const entry of signed ?? []) {
      // `path` echoes the request; `signedUrl` is null on a per-file denial.
      if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
    }
    return { urls, expiresIn: data.expiresIn };
  });
