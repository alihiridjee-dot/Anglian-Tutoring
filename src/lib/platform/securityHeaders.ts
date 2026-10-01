/**
 * Security headers on every response the app server sends.
 *
 * Set here rather than in vercel.json: the Vercel build ships Nitro's Build
 * Output (.vercel/output/config.json), whose own routes decide the headers, so
 * vercel.json headers can't be relied on. Static files under /assets don't pass
 * through here; they're scripts and styles with correct types, never pages.
 *
 * Enforced now:
 *  - no framing by any other site (clickjacking): X-Frame-Options and the
 *    CSP frame-ancestors directive, for old and new browsers alike;
 *  - nosniff, so a file is only ever run as the type it was sent as;
 *  - the referrer cut to our origin on other sites (no paths, which carry ids).
 *
 * The Content-Security-Policy itself is report-only for a first week: browsers
 * log what it would block in the console, and nothing breaks. Once a week of
 * use shows no reports, its header name changes to Content-Security-Policy.
 */

/** What the app really loads, beyond itself. */
function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : "";
  const supabaseSocket = supabase.replace(/^https:/, "wss:");
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // TanStack Start streams its hydration data in inline scripts, with no nonce.
    ["script-src", "'self'", "'unsafe-inline'"],
    ["style-src", "'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    ["font-src", "'self'", "data:", "https://fonts.gstatic.com"],
    // Supabase storage (photos, signed URLs), picked-file previews, video
    // thumbnails and the landing page's photos.
    [
      "img-src",
      "'self'",
      "data:",
      "blob:",
      supabase,
      "https://i.ytimg.com",
      "https://images.unsplash.com",
    ],
    // A tutor can attach a video file from any host; it plays in a <video>.
    ["media-src", "'self'", "blob:", "https:"],
    ["connect-src", "'self'", supabase, supabaseSocket],
    [
      "frame-src",
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
      "https://player.vimeo.com",
    ],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  return directives.map((d) => d.filter(Boolean).join(" ")).join("; ");
}

export function securityHeaders(supabaseUrl: string | undefined): Record<string, string> {
  return {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy-Report-Only": contentSecurityPolicy(supabaseUrl),
  };
}

/** The response with the headers added. A copy, since a fetched one is immutable. */
export function withSecurityHeaders(response: Response, supabaseUrl: string | undefined): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders(supabaseUrl))) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
}
