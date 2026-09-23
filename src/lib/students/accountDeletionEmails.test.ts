import { describe, expect, test } from "bun:test";
import {
  buildEmail,
  formatUkDate,
  type Recipient,
} from "../../../supabase/functions/delete-account/emails";

const student: Recipient = { email: "bea@example.com", name: "Bea", audience: "student" };
const parent: Recipient = { email: "mum@example.com", name: "Sam", audience: "parent" };
const staff: Recipient = { email: "tutor@example.com", name: "Ali", audience: "staff" };
const ctx = { studentName: "Bea", studentEmail: "bea@example.com", purgeDate: "30 September 2026" };

describe("formatUkDate", () => {
  test("uses UK time, so a late-evening UTC instant lands on the next UK day in summer", () => {
    expect(formatUkDate("2026-09-29T23:30:00Z")).toBe("30 September 2026");
  });
});

describe("buildEmail", () => {
  test("the student is spoken to about their own account", () => {
    const e = buildEmail("scheduled", student, ctx);
    expect(e.subject).toBe("Your Anglia Educate account will be deleted on 30 September 2026");
    expect(e.text).toContain("Hi Bea,");
    expect(e.text).toContain("you won't be charged again");
    expect(e.text).not.toContain("Your own account isn't affected");
  });

  test("a parent is told whose account it is, and that theirs stays", () => {
    const e = buildEmail("scheduled", parent, ctx);
    expect(e.subject).toBe("Bea's Anglia Educate account will be deleted on 30 September 2026");
    expect(e.text).toContain("Hi Sam,");
    expect(e.text).toContain("Your own account isn't affected.");
    expect(e.text).toContain("reply to this email before 30 September 2026");
  });

  test("staff get the email address, so two students of one name are told apart", () => {
    const e = buildEmail("scheduled", staff, ctx);
    expect(e.subject).toBe("Deletion booked: Bea");
    expect(e.text).toContain("Bea (bea@example.com) will be deleted on 30 September 2026.");
  });

  test("the plan line on undo appears only when a plan was restarted", () => {
    expect(buildEmail("cancelled", parent, { ...ctx, planResumed: true }).text).toContain(
      "The plan has restarted",
    );
    expect(buildEmail("cancelled", parent, ctx).text).not.toContain("The plan has restarted");
  });

  test("the final email says what went and what Stripe keeps", () => {
    const e = buildEmail("completed", student, ctx);
    expect(e.subject).toBe("Your Anglia Educate account has been deleted");
    expect(e.text).toContain("along with your work, marks, messages and billing details");
    expect(e.text).toContain("Stripe, keeps a record of past payments");
  });

  test("a missing name falls back to a plain greeting", () => {
    expect(buildEmail("completed", { ...parent, name: null }, ctx).text.startsWith("Hi,\n")).toBe(
      true,
    );
  });

  test("names are escaped in the HTML body", () => {
    const e = buildEmail("scheduled", parent, { ...ctx, studentName: "<b>Bea</b>" });
    expect(e.html).toContain("&lt;b&gt;Bea&lt;/b&gt;");
    expect(e.html).not.toContain("<b>Bea</b>");
  });
});
