import { beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { UserRole } from "@/types/user";

/**
 * A stand-in for the three reads the guard makes. Each test sets what the
 * "network" answers, then counts how often it was asked.
 */
type Reply<T> = { data: T; error: null } | { data: null; error: Error };
const net = {
  profile: { data: { role: "student" }, error: null } as Reply<{ role: string } | null>,
  roles: { data: [], error: null } as Reply<{ role: string }[]>,
  access: {
    data: { onboarding_complete: true, has_access: true },
    error: null,
  } as Reply<{ onboarding_complete: boolean; has_access: boolean }>,
  accessCalls: 0,
};

mock.module("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "profiles"
            ? { maybeSingle: () => Promise.resolve(net.profile) }
            : Promise.resolve(net.roles),
      }),
    }),
    rpc: () => ({
      single: () => {
        net.accessCalls += 1;
        return Promise.resolve(net.access);
      },
    }),
  },
}));

const { loadGuardState, resolveAppRole } = await import("./guardState");

const client = () => new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });

beforeEach(() => {
  net.profile = { data: { role: "student" }, error: null };
  net.roles = { data: [], error: null };
  net.access = { data: { onboarding_complete: true, has_access: true }, error: null };
  net.accessCalls = 0;
});

describe("resolveAppRole", () => {
  test("a staff grant wins over whatever the profile says", () => {
    expect(resolveAppRole(["tutor"], "student")).toBe(UserRole.TUTOR);
    expect(resolveAppRole(["student", "admin"], "parent")).toBe(UserRole.ADMIN);
  });

  test("with no staff grant the profile decides, and the fallback is student", () => {
    expect(resolveAppRole([], "parent")).toBe(UserRole.PARENT);
    expect(resolveAppRole(["student"], "student")).toBe(UserRole.STUDENT);
    expect(resolveAppRole([], null)).toBe(UserRole.STUDENT);
    expect(resolveAppRole([], "something-new")).toBe(UserRole.STUDENT);
  });
});

describe("loadGuardState", () => {
  test("a fresh answer is reused, so a navigation costs no requests", async () => {
    const qc = client();
    await loadGuardState(qc, "u1");
    await loadGuardState(qc, "u1");
    expect(net.accessCalls).toBe(1);
  });

  test("a stale answer is re-asked rather than served for ever", async () => {
    const qc = client();
    net.access = { data: { onboarding_complete: true, has_access: false }, error: null };
    expect((await loadGuardState(qc, "u1")).hasAccess).toBe(false);

    // A parent pays on another device; the entry ages past its minute.
    net.access = { data: { onboarding_complete: true, has_access: true }, error: null };
    await qc.invalidateQueries();
    expect((await loadGuardState(qc, "u1")).hasAccess).toBe(true);
  });

  test("a failed re-read keeps the last good answer", async () => {
    const qc = client();
    await loadGuardState(qc, "u1");
    await qc.invalidateQueries();

    net.access = { data: null, error: new Error("timeout") };
    const state = await loadGuardState(qc, "u1");
    expect(state.onboardingComplete).toBe(true);
    expect(state.hasAccess).toBe(true);
  });

  test("an unanswered access check is unknown, never 'no' — and is not cached", async () => {
    const qc = client();
    net.access = { data: null, error: new Error("timeout") };
    const state = await loadGuardState(qc, "u1");
    expect(state.appRole).toBe(UserRole.STUDENT);
    expect(state.onboardingComplete).toBeNull();
    expect(state.hasAccess).toBeNull();

    net.access = { data: { onboarding_complete: true, has_access: true }, error: null };
    expect((await loadGuardState(qc, "u1")).hasAccess).toBe(true);
  });

  test("a failed role read is not mistaken for 'student', and is not cached", async () => {
    const qc = client();
    net.roles = { data: null, error: new Error("offline") };
    const unknown = await loadGuardState(qc, "u1");
    expect(unknown.role).toBeNull();
    expect(unknown.hasAccess).toBeNull();

    net.roles = { data: [{ role: "tutor" }], error: null };
    net.profile = { data: { role: "tutor" }, error: null };
    const tutor = await loadGuardState(qc, "u1");
    expect(tutor.appRole).toBe(UserRole.TUTOR);
    // Staff have nothing to onboard or buy, so the access RPC is never asked.
    expect(tutor.hasAccess).toBe(true);
  });
});
