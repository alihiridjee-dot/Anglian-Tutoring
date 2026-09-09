import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AVATAR_BUCKET, AVATAR_URL_TTL_SECONDS } from "@/lib/avatar";

/** Re-sign a minute before expiry, so a URL is never handed out already dead. */
const REFRESH_MARGIN_SECONDS = 60;

/**
 * Turns a stored avatar path into a URL that can actually be rendered.
 *
 * The `avatars` bucket is private, so there is no permanent URL to store — the
 * profile row holds the object's path and the URL is minted per read, under the
 * caller's own JWT. The "avatars owner read" policy is what decides the answer,
 * which means this hook needs no permission check of its own: a path belonging
 * to someone else simply fails to sign.
 *
 * Cached by path and re-signed shortly before the token expires. An image the
 * browser has already loaded keeps rendering regardless — expiry only governs
 * the next fetch — so this is about surviving navigation, not about the picture
 * vanishing mid-page.
 */
export function useAvatarUrl(path: string | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: ["avatar-signed-url", path],
    enabled: !!path,
    queryFn: async () => {
      if (!path) return null;
      const { data, error } = await supabase.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(path, AVATAR_URL_TTL_SECONDS);
      // A missing object and an RLS denial both land here. Neither is worth an
      // error state on a decorative element: null falls back to the initials
      // disc, which is what someone without a photo sees anyway.
      if (error) return null;
      return data?.signedUrl ?? null;
    },
    staleTime: (AVATAR_URL_TTL_SECONDS - REFRESH_MARGIN_SECONDS) * 1000,
    gcTime: AVATAR_URL_TTL_SECONDS * 1000,
  });

  return data ?? null;
}
