import { describe, expect, test } from "bun:test";
import { completeOnboarding, NoSubjectsError } from "./onboarding";

/** Just enough of the Supabase client: a subject count, and the profile update. */
function fakeDb(subjects: number, countError: Error | null = null) {
  const updates: unknown[] = [];
  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: async () => {
          expect(table).toBe("student_enrolments");
          return { count: countError ? null : subjects, error: countError };
        },
      }),
      update: (values: unknown) => ({
        eq: async () => {
          expect(table).toBe("profiles");
          updates.push(values);
          return { error: null };
        },
      }),
    }),
  };
  return { db: db as unknown as Parameters<typeof completeOnboarding>[1], updates };
}

describe("completeOnboarding", () => {
  test("finishes setup for a student with a subject", async () => {
    const { db, updates } = fakeDb(2);
    await completeOnboarding("student", db);
    expect(updates).toHaveLength(1);
  });

  test("refuses with no subject saved, and leaves setup unfinished", async () => {
    const { db, updates } = fakeDb(0);
    await expect(completeOnboarding("student", db)).rejects.toBeInstanceOf(NoSubjectsError);
    expect(updates).toHaveLength(0);
  });

  test("a failed count is an error, not a pass", async () => {
    const { db, updates } = fakeDb(0, new Error("network"));
    await expect(completeOnboarding("student", db)).rejects.toThrow("network");
    expect(updates).toHaveLength(0);
  });
});
