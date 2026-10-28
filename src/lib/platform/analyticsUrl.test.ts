import { describe, expect, test } from "bun:test";
import { scrubAnalyticsEvent, scrubAnalyticsUrl } from "./analyticsUrl";

const SITE = "https://angliaeducate.co.uk";
const ID = "3f2a9c1e-8b7d-4e6f-a5c4-1b2d3e4f5a6b";

describe("scrubAnalyticsUrl", () => {
  test("drops the hash a sign-in lands with", () => {
    expect(scrubAnalyticsUrl(`${SITE}/auth#access_token=x&refresh_token=y&type=recovery`)).toBe(
      `${SITE}/auth`,
    );
    expect(scrubAnalyticsUrl(`${SITE}/reset-password#error=access_denied`)).toBe(
      `${SITE}/reset-password`,
    );
  });

  test("drops the query", () => {
    expect(scrubAnalyticsUrl(`${SITE}/messages?thread=${ID}`)).toBe(`${SITE}/messages`);
    expect(scrubAnalyticsUrl(`${SITE}/billing?session_id=cs_live_1#top`)).toBe(`${SITE}/billing`);
  });

  test("turns an id in the path into :id", () => {
    expect(scrubAnalyticsUrl(`${SITE}/students/${ID}`)).toBe(`${SITE}/students/:id`);
    expect(scrubAnalyticsUrl(`${SITE}/homework/${ID.toUpperCase()}?tab=marked`)).toBe(
      `${SITE}/homework/:id`,
    );
  });

  test("leaves an ordinary page alone", () => {
    expect(scrubAnalyticsUrl(`${SITE}/`)).toBe(`${SITE}/`);
    expect(scrubAnalyticsUrl(`${SITE}/how-it-works`)).toBe(`${SITE}/how-it-works`);
    expect(scrubAnalyticsUrl("/privacy")).toBe("/privacy");
  });
});

describe("scrubAnalyticsEvent", () => {
  test("keeps the event and scrubs only its address", () => {
    expect(scrubAnalyticsEvent({ type: "pageview", url: `${SITE}/auth#access_token=x` })).toEqual({
      type: "pageview",
      url: `${SITE}/auth`,
    });
  });
});
