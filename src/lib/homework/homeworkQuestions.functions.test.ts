import { afterAll, describe, expect, mock, test } from "bun:test";

/**
 * The tutor's task-question generator calls the model once per picked point,
 * so it must claim on the hourly budget before it reads a point or calls the
 * model. `createServerFn` only hands back a callable handler after the app's
 * build step, so this file swaps it for a pass-through while its own tests
 * run. Bun's module mocks are process-wide and never undone, so it hands back
 * to the real one afterwards (as in session.test.ts).
 */
const realStart = { ...(await import("@tanstack/react-start")) };
const realCreateServerFn = realStart.createServerFn;
let faking = true;
afterAll(() => {
  faking = false;
});

type Call = { data: unknown; context: unknown };

function passThrough() {
  let validate = (input: unknown) => input;
  const builder = {
    middleware: () => builder,
    inputValidator: (fn: (input: unknown) => unknown) => {
      validate = fn;
      return builder;
    },
    handler: (fn: (call: Call) => unknown) => (call: Call) =>
      fn({ data: validate(call.data), context: call.context }),
  };
  return builder;
}

mock.module("@tanstack/react-start", () => ({
  ...realStart,
  createServerFn: (...args: Parameters<typeof realCreateServerFn>) =>
    faking ? passThrough() : realCreateServerFn(...args),
}));

// A computed path keeps the test typecheck (Bun's own `fetch` type) from
// following the generator into the generated auth middleware.
const generatorPath = "./homeworkQuestions.functions";
const { generateHomeworkQuestions: run } = (await import(generatorPath)) as {
  generateHomeworkQuestions: (call: Call) => Promise<unknown>;
};

/** Answers the role read, the claim and the spec point read; records each. */
function fakeSupabase(opts: { roles: string[]; claim: boolean | null; claimError?: unknown }) {
  const tables: string[] = [];
  const claims: unknown[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const rows = table === "user_roles" ? opts.roles.map((role) => ({ role })) : [];
      const query = {
        select: () => query,
        eq: () => Promise.resolve({ data: rows, error: null }),
        in: () => Promise.resolve({ data: rows, error: null }),
      };
      return query;
    },
    rpc(fn: string, args: unknown) {
      claims.push({ fn, args });
      return Promise.resolve({ data: opts.claim, error: opts.claimError ?? null });
    },
  };
  return { client, tables, claims };
}

const data = { specPointIds: ["p1"], subject: "biology", board: "aqa", level: "gcse", count: 5 };
const spent = /used the AI drafting tools a lot this hour/;

describe("generateHomeworkQuestions quota", () => {
  test("a tutor whose hour is spent is refused before any point is read", async () => {
    const db = fakeSupabase({ roles: ["tutor"], claim: false });
    await expect(run({ data, context: { supabase: db.client, userId: "t1" } })).rejects.toThrow(
      spent,
    );
    expect(db.claims).toEqual([
      {
        fn: "claim_ai_request",
        args: expect.objectContaining({ _endpoint: "homework_generation" }),
      },
    ]);
    expect(db.tables).not.toContain("spec_points");
  });

  test("a claim that fails is a refusal too", async () => {
    const db = fakeSupabase({ roles: ["tutor"], claim: null, claimError: { message: "down" } });
    await expect(run({ data, context: { supabase: db.client, userId: "t1" } })).rejects.toThrow(
      spent,
    );
    expect(db.tables).not.toContain("spec_points");
  });

  test("a student is refused before anything is claimed", async () => {
    const db = fakeSupabase({ roles: ["student"], claim: true });
    await expect(run({ data, context: { supabase: db.client, userId: "s1" } })).rejects.toThrow(
      "Tutor access required",
    );
    expect(db.claims).toEqual([]);
  });

  test("a tutor with budget left claims once and goes on to the points", async () => {
    const db = fakeSupabase({ roles: ["tutor"], claim: true });
    // No point comes back from the fake, so it stops before the model.
    await expect(run({ data, context: { supabase: db.client, userId: "t1" } })).rejects.toThrow(
      "No matching spec points found",
    );
    expect(db.claims).toHaveLength(1);
    expect(db.tables).toContain("spec_points");
  });
});
