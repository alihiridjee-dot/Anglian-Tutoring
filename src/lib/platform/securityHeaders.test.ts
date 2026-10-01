import { describe, expect, test } from "bun:test";
import { securityHeaders, withSecurityHeaders } from "./securityHeaders";

const SUPABASE = "https://abcdefgh.supabase.co";

describe("securityHeaders", () => {
  const headers = securityHeaders(SUPABASE);
  const csp = headers["Content-Security-Policy-Report-Only"];
  const directive = (name: string) =>
    csp
      .split("; ")
      .find((d) => d.startsWith(`${name} `))
      ?.split(" ")
      .slice(1);

  test("framing, sniffing and referrers are enforced", () => {
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("the full policy only reports, and allows the app's own Supabase", () => {
    expect(directive("connect-src")).toEqual(["'self'", SUPABASE, "wss://abcdefgh.supabase.co"]);
    expect(directive("img-src")).toContain(SUPABASE);
    expect(directive("frame-src")).toContain("https://www.youtube-nocookie.com");
    expect(directive("object-src")).toEqual(["'none'"]);
  });

  test("with no Supabase URL there are no empty sources", () => {
    expect(securityHeaders(undefined)["Content-Security-Policy-Report-Only"]).not.toMatch(
      / {2}| ;/,
    );
  });
});

describe("withSecurityHeaders", () => {
  test("adds the headers, keeps status, type and body", async () => {
    const original = new Response("<html></html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
    const secured = withSecurityHeaders(original, SUPABASE);
    expect(secured.status).toBe(404);
    expect(secured.headers.get("content-type")).toBe("text/html");
    expect(secured.headers.get("x-frame-options")).toBe("DENY");
    expect(await secured.text()).toBe("<html></html>");
  });

  test("works on an immutable response, like one from fetch", () => {
    const immutable = Response.redirect("https://example.com/", 302);
    expect(withSecurityHeaders(immutable, SUPABASE).headers.get("location")).toBe(
      "https://example.com/",
    );
  });
});
