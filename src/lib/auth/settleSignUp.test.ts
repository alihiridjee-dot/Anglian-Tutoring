import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  forgetSignUp,
  readSignUp,
  rememberSignUp,
  settleSignUp,
  signUpDrift,
  signUpMetadata,
  type SignUpChoice,
} from "./settleSignUp";

const choice = (over: Partial<SignUpChoice> = {}): SignUpChoice => ({
  password: "new-password-1",
  displayName: "Jamie Doe",
  role: "student",
  inviteCode: null,
  tier: null,
  level: null,
  subjects: null,
  board: null,
  ...over,
});

/** Just enough of the Supabase client, recording every call it gets. */
function fakeDb({
  passwordError = null as { code?: string; message: string } | null,
  settleStatus = "settled",
  linkStatus = "linked",
} = {}) {
  const calls: string[] = [];
  const db = {
    auth: {
      updateUser: async (attrs: { password?: string; data?: unknown }) => {
        if (attrs.password) {
          calls.push(`password:${attrs.password}`);
          return { error: passwordError };
        }
        calls.push(`metadata:${JSON.stringify(attrs.data)}`);
        return { error: null };
      },
    },
    from: (table: string) => ({
      update: (values: { display_name: string }) => ({
        eq: async (_col: string, id: string) => {
          calls.push(`${table}:${id}:${values.display_name}`);
          return { error: null };
        },
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push(`${fn}:${JSON.stringify(args)}`);
      if (fn === "settle_sign_up_role") return { data: { status: settleStatus }, error: null };
      return { data: { status: linkStatus, student_name: "Sam" }, error: null };
    },
  };
  return { db: db as unknown as Parameters<typeof settleSignUp>[2], calls };
}

const user = (meta: Record<string, unknown>) => ({ id: "u1", user_metadata: meta });

describe("signUpDrift", () => {
  test("an ordinary first sign-up matches its own metadata", () => {
    const c = choice({ role: "parent", inviteCode: "ANG-AAAA", tier: "gcse" });
    expect(signUpDrift(c, signUpMetadata(c))).toEqual({
      metadata: false,
      displayName: false,
      role: false,
    });
  });

  test("a different role, name or code shows up", () => {
    const first = signUpMetadata(choice({ role: "parent", inviteCode: "ANG-AAAA" }));
    expect(signUpDrift(choice(), first).role).toBe(true);
    expect(signUpDrift(choice({ displayName: "Sam" }), first).displayName).toBe(true);
    const otherCode = choice({ role: "parent", inviteCode: "ANG-BBBB" });
    expect(signUpDrift(otherCode, first).role).toBe(true);
  });

  test("codes compare trimmed and in upper case, as the database matches them", () => {
    const first = signUpMetadata(choice({ role: "parent", inviteCode: " ang-aaaa " }));
    expect(signUpDrift(choice({ role: "parent", inviteCode: "ANG-AAAA" }), first).role).toBe(false);
  });

  test("metadata with no role is a student, as handle_new_user makes it", () => {
    expect(signUpDrift(choice(), {}).role).toBe(false);
    expect(signUpDrift(choice({ role: "parent" }), {}).role).toBe(true);
  });
});

describe("settleSignUp", () => {
  test("an ordinary sign-up sends only the password, and same_password counts as saved", async () => {
    const c = choice();
    const { db, calls } = fakeDb({ passwordError: { code: "same_password", message: "same" } });
    const result = await settleSignUp(c, user(signUpMetadata(c)), db);
    expect(calls).toEqual(["password:new-password-1"]);
    expect(result).toEqual({ passwordSaved: true, link: null });
  });

  test("a second sign-up as a student puts the form's password, name and role in", async () => {
    const first = signUpMetadata(
      choice({ displayName: "Earlier", role: "parent", inviteCode: "ANG-AAAA" }),
    );
    const { db, calls } = fakeDb();
    const result = await settleSignUp(choice(), user(first), db);
    expect(calls[0]).toBe("password:new-password-1");
    expect(calls[1]).toStartWith("metadata:");
    expect(calls[2]).toBe("profiles:u1:Jamie Doe");
    expect(calls[3]).toBe('settle_sign_up_role:{"_role":"student","_invite_code":""}');
    expect(calls).toHaveLength(4);
    expect(result).toEqual({ passwordSaved: true, link: null });
  });

  test("a second sign-up as a parent links the code once the role is settled", async () => {
    const first = signUpMetadata(choice());
    const { db, calls } = fakeDb();
    const result = await settleSignUp(
      choice({ role: "parent", inviteCode: "ANG-BBBB" }),
      user(first),
      db,
    );
    expect(calls.at(-2)).toBe('settle_sign_up_role:{"_role":"parent","_invite_code":"ANG-BBBB"}');
    expect(calls.at(-1)).toBe('link_child_by_code:{"_code":"ANG-BBBB"}');
    expect(result.link).toEqual({ status: "linked", student_name: "Sam" });
  });

  test("a refused settle links nothing", async () => {
    const { db, calls } = fakeDb({ settleStatus: "not_eligible" });
    const result = await settleSignUp(
      choice({ role: "parent", inviteCode: "ANG-BBBB" }),
      user(signUpMetadata(choice())),
      db,
    );
    expect(calls.some((c) => c.startsWith("link_child_by_code"))).toBe(false);
    expect(result.link).toBeNull();
  });

  test("a password the server refuses is reported", async () => {
    const c = choice();
    const { db } = fakeDb({ passwordError: { code: "weak_password", message: "weak" } });
    const result = await settleSignUp(c, user(signUpMetadata(c)), db);
    expect(result.passwordSaved).toBe(false);
  });

  test("from logging in, the stored password stays and the role is still settled", async () => {
    const first = signUpMetadata(choice());
    const { db, calls } = fakeDb();
    const result = await settleSignUp(
      choice({ password: null, role: "parent", inviteCode: "ANG-BBBB" }),
      user(first),
      db,
    );
    expect(calls.some((c) => c.startsWith("password:"))).toBe(false);
    expect(calls.at(-1)).toBe('link_child_by_code:{"_code":"ANG-BBBB"}');
    expect(result).toEqual({
      passwordSaved: true,
      link: { status: "linked", student_name: "Sam" },
    });
  });
});

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

describe("the sign-up form kept for this tab", () => {
  const g = globalThis as { window?: unknown };
  let store: MemoryStorage;
  beforeEach(() => {
    store = new MemoryStorage();
    g.window = { sessionStorage: store };
  });
  afterEach(() => {
    delete g.window;
  });

  test("never keeps the password", () => {
    rememberSignUp("jamie@example.com", choice({ password: "secret-password-9" }));
    expect(store.getItem("sign-up-choice")).not.toContain("secret-password-9");
    expect(readSignUp("jamie@example.com")).not.toHaveProperty("password");
  });

  test("comes back for the same email, however it is typed, and only for that email", () => {
    const c = choice({ role: "parent", inviteCode: "ANG-AAAA", displayName: "Pat" });
    rememberSignUp("Jamie@Example.com", c);
    const { password: _pw, ...rest } = c;
    expect(readSignUp(" jamie@example.com ")).toEqual(rest);
    expect(readSignUp("someone@example.com")).toBeNull();
  });

  test("survives a second read, so another reload still finds it, until forgotten", () => {
    rememberSignUp("jamie@example.com", choice());
    expect(readSignUp("jamie@example.com")).not.toBeNull();
    expect(readSignUp("jamie@example.com")).not.toBeNull();
    forgetSignUp();
    expect(readSignUp("jamie@example.com")).toBeNull();
  });

  test("anything that isn't a student or parent choice is ignored", () => {
    store.setItem(
      "sign-up-choice",
      JSON.stringify({ email: "jamie@example.com", saved: { role: "admin", displayName: "x" } }),
    );
    expect(readSignUp("jamie@example.com")).toBeNull();
    store.setItem("sign-up-choice", "not json");
    expect(readSignUp("jamie@example.com")).toBeNull();
  });

  test("storage that refuses is not an error", () => {
    g.window = {
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    };
    expect(() => rememberSignUp("jamie@example.com", choice())).not.toThrow();
    expect(readSignUp("jamie@example.com")).toBeNull();
    expect(() => forgetSignUp()).not.toThrow();
  });
});
