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

export const createResourceSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SignInput) => {
    const raw = typeof input?.path === "string" ? input.path.trim() : "";
    if (!raw) throw new Error("A file path is required");
    // Guard against absolute paths and traversal; RLS is the real gate, this
    // just rejects obviously malformed input before hitting Storage.
    if (raw.startsWith("/") || raw.includes("..")) {
      throw new Error("Invalid file path");
    }
    const ttl = Number(input?.expiresIn);
    return {
      path: raw,
      expiresIn: Number.isFinite(ttl) ? Math.min(Math.max(ttl, MIN_TTL), MAX_TTL) : DEFAULT_TTL,
      download: input?.download ?? false,
    };
  })
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
