// An in-memory stand-in for the slice of supabase-js the billing edge functions
// use, mapped over "https://esm.sh/@supabase/supabase-js@2" by the import map in
// this folder, so the real function code runs against it. No network.
//
// Rows are loosely shaped by nature, so `any` is allowed in this file.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export const DB = {
  tables: {} as Record<string, Row[]>,
  unique: {} as Record<string, string[][]>,
  /** table -> an error every query on it returns (a missing table, a timeout). */
  broken: {} as Record<string, { code: string; message: string }>,
  users: {} as Record<string, { id: string; email: string }>, // bearer token -> user
  /** rpc name -> stand-in; `caller` is the bearer token the client was made with. */
  rpcs: {} as Record<string, (args: any, caller: string | null) => { data: any; error: any }>,
};

export function resetDb() {
  DB.tables = {};
  DB.unique = {
    subscriptions: [["student_id"]],
    stripe_customers: [["user_id"], ["stripe_customer_id"]],
  };
  DB.broken = {};
  DB.users = {};
  DB.rpcs = {};
}
resetDb();

export function table(name: string): Row[] {
  return (DB.tables[name] ??= []);
}

type Filter = (r: Row) => boolean;

class Query implements PromiseLike<any> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private payload: any;
  private onConflict?: string;
  private returning = false;
  private mode: "many" | "maybe" | "single" = "many";

  constructor(private t: string) {}

  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(p: any) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  update(p: any) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  upsert(p: any, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = p;
    this.onConflict = opts?.onConflict;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: any) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  is(c: string, v: any) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  in(c: string, vs: any[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }

  then<A, B>(ok?: (v: any) => A | PromiseLike<A>, bad?: (e: any) => B | PromiseLike<B>) {
    return this.exec().then(ok, bad);
  }

  private exec(): Promise<any> {
    const broken = DB.broken[this.t];
    if (broken) return Promise.resolve({ data: null, error: broken });
    const rows = table(this.t);
    const match = rows.filter((r) => this.filters.every((f) => f(r)));

    switch (this.op) {
      case "select":
        return Promise.resolve(this.shape(match.map((r) => ({ ...r }))));
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const p of list) {
          if (
            (DB.unique[this.t] ?? []).some((cols) =>
              rows.some((r) => cols.every((c) => r[c] === p[c])),
            )
          ) {
            return Promise.resolve({
              data: null,
              error: { code: "23505", message: "duplicate key" },
            });
          }
          rows.push({ ...p });
        }
        return Promise.resolve(this.returning ? this.shape(list) : { data: null, error: null });
      }
      case "update":
        for (const r of match) Object.assign(r, this.payload);
        return Promise.resolve(this.returning ? this.shape(match) : { data: null, error: null });
      case "upsert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const cols = (this.onConflict ?? "id").split(",").map((s) => s.trim());
        for (const p of list) {
          const existing = rows.find((r) => cols.every((c) => r[c] === p[c]));
          if (existing) Object.assign(existing, p);
          else rows.push({ ...p });
        }
        return Promise.resolve({ data: null, error: null });
      }
      case "delete":
        DB.tables[this.t] = rows.filter((r) => !match.includes(r));
        return Promise.resolve({ data: null, error: null });
    }
  }

  private shape(data: Row[]) {
    if (this.mode === "many") return { data, error: null };
    if (data.length > 1)
      return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
    if (this.mode === "single" && data.length === 0) {
      return { data: null, error: { code: "PGRST116", message: "no rows" } };
    }
    return { data: data[0] ?? null, error: null };
  }
}

export function createClient(
  _url?: string,
  _key?: string,
  opts?: { global?: { headers?: Record<string, string> } },
) {
  // A client made "as the caller" carries their token in its headers.
  const bearer = opts?.global?.headers?.Authorization?.replace(/^Bearer\s+/i, "") ?? null;
  return {
    from: (t: string) => new Query(t),
    rpc: async (name: string, args: any) =>
      DB.rpcs[name]
        ? DB.rpcs[name](args, bearer)
        : { data: null, error: { code: "PGRST202", message: `no function ${name}` } },
    auth: {
      getUser: async (token?: string) => {
        const u = DB.users[token ?? bearer ?? ""];
        return u
          ? { data: { user: u }, error: null }
          : { data: { user: null }, error: { message: "bad jwt" } };
      },
    },
  };
}
