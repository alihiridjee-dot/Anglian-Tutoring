import { useEffect, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { createResourceSignedUrl } from "@/lib/storage.functions";
import { DEMO_FILE_PREFIX } from "@/lib/demo/studentDemo";

/**
 * An image stored in the private `resources` bucket, rendered inline.
 *
 * Unlike SignedFileLink this resolves its signed URL on mount rather than on
 * click — a question figure or a photo of working is part of the page, not
 * something you go and open. Signed URLs are short-lived, so a card left open
 * for a long time may need a reload; that's preferable to minting long-lived
 * links to student work.
 */
export function SignedImage({
  path,
  alt,
  className,
}: {
  path: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (path.startsWith(DEMO_FILE_PREFIX)) {
      setFailed(true);
      return;
    }
    setUrl(null);
    setFailed(false);
    createResourceSignedUrl({ data: { path } })
      .then(({ url }) => {
        if (!cancelled) setUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const box = className ?? "max-h-72 rounded-lg border border-border object-contain";

  if (failed) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <ImageOff className="w-3.5 h-3.5" />
        Image unavailable
      </span>
    );
  }
  if (!url) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading image…
      </span>
    );
  }
  return <img src={url} alt={alt} className={box} onError={() => setFailed(true)} />;
}
