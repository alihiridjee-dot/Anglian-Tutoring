import { useEffect, useState } from "react";
import { PlayCircle, X, ExternalLink } from "lucide-react";
import { type VideoEmbed } from "@/lib/videoEmbed";

/**
 * Poster tile for a video. Uses the real YouTube thumbnail when we can derive
 * one; otherwise a branded gradient. Renders just the visual — callers wrap it
 * in whatever clickable element opens the player.
 */
export function VideoThumbnail({
  embed,
  className = "",
}: {
  embed: VideoEmbed | null;
  className?: string;
}) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = embed?.thumbnailUrl && imgOk;
  return (
    <div
      className={`relative aspect-video bg-gradient-to-br from-secondary to-muted flex items-center justify-center overflow-hidden ${className}`}
    >
      {showImg && (
        <img
          src={embed!.thumbnailUrl!}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setImgOk(false)}
        />
      )}
      <div className="absolute inset-0 bg-black/10 group-hover:bg-black/25 transition-colors" />
      <span className="relative w-14 h-14 rounded-full bg-white/90 shadow-lg flex items-center justify-center group-hover:scale-105 transition-transform">
        <PlayCircle className="w-9 h-9 text-primary" />
      </span>
    </div>
  );
}

/**
 * Full-screen lightbox that embeds the actual player in-page — YouTube/Vimeo via
 * iframe, direct files via a native <video>, and anything unrecognised falls back
 * to an "open in new tab" link so no video is ever unreachable.
 */
export function VideoModal({
  embed,
  title,
  description,
  onClose,
}: {
  embed: VideoEmbed;
  title: string;
  description?: string | null;
  onClose: () => void;
}) {
  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-card rounded-2xl overflow-hidden shadow-2xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close player"
          className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="aspect-video bg-black">
          {embed.embedUrl ? (
            <iframe
              src={embed.embedUrl}
              title={title}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : embed.fileUrl ? (
            <video src={embed.fileUrl} controls autoPlay className="w-full h-full" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/80">
              <p className="text-sm">This video can't be embedded here.</p>
              <a
                href={embed.originalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
              >
                <ExternalLink className="w-4 h-4" />
                Open in new tab
              </a>
            </div>
          )}
        </div>

        <div className="p-4">
          <p className="font-semibold">{title}</p>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
      </div>
    </div>
  );
}
