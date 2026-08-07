import { useEffect, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { getSignedUrl, msUntilRefresh } from "@/lib/signedUrlCache";
import { DEMO_FILE_PREFIX } from "@/lib/demo/studentDemo";

/**
 * An image stored in the private `resources` bucket, rendered inline.
 *
 * Unlike SignedFileLink this resolves its signed URL on mount rather than on
 * click — a question figure or a photo of working is part of the page, not
 * something you go and open.
 *
 * The URL comes from [[signedUrlCache]], which batches every image that mounts
 * in the same tick into one request and re-signs before the five-minute link
 * expires. Links to student work stay short-lived; they're renewed rather than
 * issued long, so a homework page left open mid-answer doesn't quietly fill
 * with broken images.
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
    if (path.startsWith(DEMO_FILE_PREFIX)) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    let renewal: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      getSignedUrl(path)
        .then((next) => {
          if (cancelled) return;
          if (!next) {
            setFailed(true);
            return;
          }
          setUrl(next);
          // Re-sign just before this link lapses, so a long read never lands on
          // a dead URL.
          const wait = msUntilRefresh(path);
          if (wait != null) renewal = setTimeout(load, wait);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };

    setUrl(null);
    setFailed(false);
    load();

    return () => {
      cancelled = true;
      if (renewal) clearTimeout(renewal);
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
