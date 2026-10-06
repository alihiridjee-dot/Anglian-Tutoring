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

/** Seconds from a YouTube start time ("90", "90s", "1m30s", "1h2m3s"), or null. */
function youtubeStart(u: URL): number | null {
  const raw =
    u.searchParams.get("t") ??
    u.searchParams.get("start") ??
    new URLSearchParams(u.hash.slice(1)).get("t");
  const m = raw?.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!m) return null;
  const secs = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return secs > 0 ? secs : null;
}

/**
 * Extract a Vimeo video id, plus the hash an unlisted video can't play without
 * (vimeo.com/<id>/<hash>, or ?h= on a player link), or null.
 */
function vimeoVideo(u: URL): { id: string; hash: string | null } | null {
  const host = u.hostname.replace(/^www\./, "");
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  const h = u.searchParams.get("h");
  const queryHash = h && /^[0-9a-z]+$/i.test(h) ? h : null;
  // Player links, and a video inside a showcase, album or group: /video/<id>.
  const inner = u.pathname.match(/\/videos?\/(\d+)/);
  if (inner) return { id: inner[1], hash: queryHash };
  // vimeo.com/<id>, unlisted vimeo.com/<id>/<hash>, or channels/<name>/<id>.
  // Anything else (a showcase on its own, a user page) isn't one video.
  const m = u.pathname.match(/^\/(?:channels\/[^/]+\/)?(\d+)(?:\/([0-9a-z]+))?\/?$/i);
  return m ? { id: m[1], hash: m[2] ?? queryHash } : null;
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
    // A start time and a playlist the tutor linked to carry through.
    const params = new URLSearchParams({ rel: "0", modestbranding: "1" });
    const start = youtubeStart(u);
    if (start) params.set("start", String(start));
    const list = u.searchParams.get("list");
    if (list && /^[\w-]+$/.test(list)) params.set("list", list);
    return {
      provider: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?${params}`,
      fileUrl: null,
      thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      originalUrl,
    };
  }

  const vm = vimeoVideo(u);
  if (vm) {
    return {
      provider: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${vm.id}${vm.hash ? `?h=${vm.hash}` : ""}`,
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
