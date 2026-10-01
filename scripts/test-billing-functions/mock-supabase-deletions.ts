// The in-memory Supabase from mock-supabase.ts, plus what delete-account uses
// and the billing functions don't: the gt/lt/lte filters, PostgREST's `or`
// filter string, and auth.admin. Kept apart so mock-supabase.ts stays the same
// file every billing branch shares. Mapped in by import_map.deletions.json.
//
// Rows are loosely shaped by nature, so `any` is allowed in this file.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient as baseClient } from "./mock-supabase.ts";
export * from "./mock-supabase.ts";

type Row = Record<string, any>;
type Filtered = { filters: ((r: Row) => boolean)[] };

/** Timestamps compare as instants; anything else as itself. */
function value(v: any): any {
  return typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : v;
}

const COMPARE: Record<string, (a: any, b: any) => boolean> = {
  eq: (a, b) => a === b,
  gt: (a, b) => a != null && value(a) > value(b),
  lt: (a, b) => a != null && value(a) < value(b),
  lte: (a, b) => a != null && value(a) <= value(b),
};

/** One `column.op.value` term of an `or` filter, with "null" and quotes read. */
function term(expr: string): (r: Row) => boolean {
  const [column, op, ...rest] = expr.split(".");
  const raw = rest.join(".").replace(/^"(.*)"$/, "$1");
  if (op === "is") return (r) => (r[column] ?? null) === (raw === "null" ? null : raw);
  const cmp = COMPARE[op];
  if (!cmp) throw new Error(`mock: or() op ${op} not supported`);
  return (r) => cmp(r[column], raw);
}

const proto = Object.getPrototypeOf(baseClient().from("_"));
for (const op of ["gt", "lt", "lte"]) {
  proto[op] = function (this: Filtered, c: string, v: any) {
    this.filters.push((r) => COMPARE[op](r[c], v));
    return this;
  };
}
proto.or = function (this: Filtered, expr: string) {
  const terms = expr.match(/(?:[^,"]|"[^"]*")+/g)!.map(term);
  this.filters.push((r) => terms.some((t) => t(r)));
  return this;
};

/** user id -> the ban_duration last set on them. */
export const BANS: Record<string, string> = {};

export function createClient(...args: Parameters<typeof baseClient>) {
  const client = baseClient(...args) as any;
  client.auth.admin = {
    updateUserById: async (id: string, attrs: { ban_duration?: string }) => {
      if (attrs.ban_duration) BANS[id] = attrs.ban_duration;
      return { data: { user: { id } }, error: null };
    },
  };
  return client;
}
