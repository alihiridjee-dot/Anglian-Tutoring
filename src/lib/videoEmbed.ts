// Turns a tutor-pasted video URL into something we can embed in-page. Supports
// YouTube (watch, youtu.be, shorts, already-embed), Vimeo, and direct file URLs
// (mp4/webm/ogg). Anything else falls back to `other`, so the UI can still offer
// an "open in new tab" link rather than a broken iframe.

export type VideoProvider = "youtube" | "vimeo" | "file" | "other";

export interface VideoEmbed {
  provider: VideoProvider;
  /** URL to load in an <iframe> (youtube/vimeo) — null for file/other. */
  embedUrl: string | null;
  /** Direct media URL for a native <video> — null unless provider === "file". */
  fileUrl: string | null;
  /** Poster/thumbnail if we can derive one (YouTube only) — else null. */
  thumbnailUrl: string | null;
  /** The original URL, always kept for an external-link fallback. */
  originalUrl: string;
}

/** Extract a YouTube video id from the common URL shapes, or null. */
function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    return u.pathname.slice(1).split("/")[0] || null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(embed|shorts|v)\/([^/?#]+)/);
    if (m) return m[2];
  }
  return null;
}

/** Extract a numeric Vimeo id, or null. */
function vimeoId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, "");
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(\d+)/);
    return m ? m[1] : null;
  }
  return null;
}

export function parseVideoUrl(raw: string | null | undefined): VideoEmbed | null {
  if (!raw) return null;
  const originalUrl = raw.trim();
  if (!originalUrl) return null;

  let u: URL;
  try {
    u = new URL(originalUrl);
  } catch {
    return { provider: "other", embedUrl: null, fileUrl: null, thumbnailUrl: null, originalUrl };
  }

  const yt = youtubeId(u);
  if (yt) {
    // Privacy-friendly nocookie host; enablejsapi off, modest branding on.
    return {
      provider: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1`,
      fileUrl: null,
      thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      originalUrl,
    };
  }

  const vm = vimeoId(u);
  if (vm) {
    return {
      provider: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${vm}`,
      fileUrl: null,
      thumbnailUrl: null,
      originalUrl,
    };
  }

  if (/\.(mp4|webm|ogg)($|\?)/i.test(u.pathname)) {
    return {
      provider: "file",
      embedUrl: null,
      fileUrl: originalUrl,
      thumbnailUrl: null,
      originalUrl,
    };
  }

  return { provider: "other", embedUrl: null, fileUrl: null, thumbnailUrl: null, originalUrl };
}
