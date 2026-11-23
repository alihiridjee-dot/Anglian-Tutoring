import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { buildContactEmail, CONTACT_INBOX, emailContactLead } from "./contactEmail";

const lead = {
  name: "Jo Bloggs",
  email: "jo@example.com",
  phone: null,
  message: "Is there a GCSE Physics group on Tuesdays?",
};

describe("buildContactEmail", () => {
  test("goes to the inbox, and Reply answers the parent", () => {
    const email = buildContactEmail(lead, "noreply@angliaeducate.co.uk");
    expect(email.to).toEqual([CONTACT_INBOX]);
    expect(email.reply_to).toBe("jo@example.com");
    expect(email.from).toBe("Anglia Educate website <noreply@angliaeducate.co.uk>");
    expect(email.subject).toBe("New enquiry from Jo Bloggs");
    expect(email.text).toContain("Phone: not given");
    expect(email.text).toContain(lead.message);
  });

  test("a sender that already has a name is left alone", () => {
    const email = buildContactEmail(lead, "Anglia Educate <hello@angliaeducate.co.uk>");
    expect(email.from).toBe("Anglia Educate <hello@angliaeducate.co.uk>");
  });

  test("a name with line breaks stays one line in the subject", () => {
    const email = buildContactEmail({ ...lead, name: "Jo\r\nBcc: x@y.z" }, "a@b.co");
    expect(email.subject).toBe("New enquiry from Jo Bcc: x@y.z");
  });
});

describe("emailContactLead", () => {
  const realFetch = globalThis.fetch;
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "noreply@angliaeducate.co.uk";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.RESEND_API_KEY = saved.key;
    process.env.EMAIL_FROM = saved.from;
    if (saved.key === undefined) delete process.env.RESEND_API_KEY;
    if (saved.from === undefined) delete process.env.EMAIL_FROM;
  });

  test("not configured: sends nothing", async () => {
    delete process.env.RESEND_API_KEY;
    const spy = mock(() => Promise.resolve(new Response("{}")));
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await emailContactLead(lead)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  test("posts the email to Resend with the key", async () => {
    const spy = mock((_url: string, _init: RequestInit) => Promise.resolve(new Response("{}")));
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await emailContactLead(lead)).toBe(true);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string).reply_to).toBe("jo@example.com");
  });

  test("a refused send returns false instead of throwing", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response("nope", { status: 500 }))) as unknown as typeof fetch;
    expect(await emailContactLead(lead)).toBe(false);
  });
});
