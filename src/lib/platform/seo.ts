/** The live address. Search engines and link previews need absolute URLs. */
export const SITE_URL = "https://angliaeducate.co.uk";

/** `<link rel="canonical">` for a public page, so `?tab=` and `www.` copies count as one page. */
export function canonical(path: string) {
  return { rel: "canonical", href: `${SITE_URL}${path}` };
}
