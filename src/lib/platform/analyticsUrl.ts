import type { BeforeSendEvent } from "@vercel/analytics/react";

/**
 * What Vercel Web Analytics is told about a page view: which page, and nothing
 * the address carries about the person on it.
 *
 * Its script reports the whole address, and on this site that can hold:
 *   • sign-in tokens in the #hash, where Google, Microsoft and password-reset
 *     links land. The sign-in library clears them only after a round trip, and
 *     never on an expired link, so the first page view could carry them;
 *   • ids and codes in the ?query: message threads, trial codes, checkout;
 *   • a student's id in the path, as in /students/<id>.
 * The hash and query go entirely, and an id in the path becomes ":id", so
 * every student's record still counts as the one page it is.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address with its hash, query and any id-shaped path part taken out. */
export function scrubAnalyticsUrl(url: string): string {
  const [page = ""] = url.split(/[?#]/, 1);
  return page
    .split("/")
    .map((part) => (UUID.test(part) ? ":id" : part))
    .join("/");
}

/** Vercel's `beforeSend`: every page view and event, scrubbed before it leaves. */
export function scrubAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: scrubAnalyticsUrl(event.url) };
}
