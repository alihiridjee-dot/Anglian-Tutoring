/** Isolated PostgreSQL checks for 20261108120000_commercial_ledger.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-commercial-ledger-db.ts
 *
 * Stubs only what the migration leans on (profiles, roles, parent links,
 * private.is_staff as production defines it) and Supabase's default grants, so
 * every revoke in the migration is exercised. PGlite is one connection, so
 * two postings racing on one account (rule 4, the row lock) is not tested here.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BILLING_INTERVALS,
  LEDGER_ENTRY_TYPES,
  LEDGER_TRANSACTION_KINDS,
} from "../src/lib/billing/commerce.ts";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const migration = await readFile(
  new URL("../supabase/migrations/20261108120000_commercial_ledger.sql", import.meta.url),
  "utf8",
);

// --- Stubs --------------------------------------------------------------------

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
-- Stricter than production needs to be: lets the test prove the private
-- helpers are closed to the service role by their own revokes.
grant usage on schema private to service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create type public.app_role as enum ('student', 'tutor', 'admin');
create type public.profile_role as enum ('student', 'parent', 'tutor');
create type public.level as enum ('gcse', 'alevel', 'gcse_trilogy', 'igcse');
create type public.subject as enum ('biology', 'chemistry', 'physics');
create type public.board as enum ('edexcel', 'aqa', 'ocr', 'cambridge', 'oxford_aqa');

create table public.profiles (
  id uuid primary key,
  display_name text,
  role public.profile_role not null default 'student'
);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);
create table public.parent_student_links (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles on delete cascade,
  student_id uuid not null references public.profiles on delete cascade,
  unique (parent_id, student_id)
);

-- Production's definition (20261003115242_tutors_are_never_students).
create or replace function private.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path to '' as $function$
  select exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role in ('tutor', 'admin'))
      or exists (select 1 from public.profiles p where p.id = _user_id and p.role = 'tutor');
$function$;

-- Supabase grants every new object in public to these roles by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

await db.exec(migration);

// --- Helpers ------------------------------------------------------------------

type Role = "postgres" | "anon" | "authenticated" | "service_role";
type Row = Record<string, unknown>;

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELF = id(1); // a student who pays for themselves
const PARENT = id(2);
const CHILD = id(3); // linked to PARENT
const STRANGER = id(4); // a student nobody here is linked to
const TUTOR = id(5);
const SECOND = id(6); // another self-paying student

async function as<T>(role: Role, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  if (role !== "postgres") await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query(sql, params)).rows as Row[];
}

async function one(sql: string, params: unknown[] = []): Promise<Row> {
  const r = await rows(sql, params);
  assert.equal(r.length, 1, `expected one row from: ${sql}`);
  return r[0];
}

async function count(table: string): Promise<number> {
  return Number((await one(`select count(*)::int as n from ${table}`)).n);
}

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    throw err;
  }
}

// --- People and a catalogue ---------------------------------------------------

await db.exec(`
insert into public.profiles (id, display_name, role) values
  ('${SELF}', 'Self', 'student'),
  ('${PARENT}', 'Parent', 'parent'),
  ('${CHILD}', 'Child', 'student'),
  ('${STRANGER}', 'Stranger', 'student'),
  ('${TUTOR}', 'Tutor', 'tutor'),
  ('${SECOND}', 'Second', 'student');
insert into public.user_roles (user_id, role) values ('${TUTOR}', 'tutor');
insert into public.parent_student_links (parent_id, student_id) values ('${PARENT}', '${CHILD}');

insert into public.access_tiers (code, name, rank) values ('standard', 'Standard', 10);
insert into public.products (id, slug, name, access_tier) values
  ('${id(100)}', 'alevel-biology-aqa', 'A-level Biology (AQA)', 'standard'),
  ('${id(101)}', 'draft-bundle', 'Not on sale yet', 'standard');
insert into public.product_modules (product_id, level, subject, board) values
  ('${id(100)}', 'alevel', 'biology', 'aqa'),
  ('${id(101)}', 'alevel', 'physics', null);
insert into public.product_prices (id, product_id, amount_pence, billing_interval, stripe_price_id) values
  ('${id(200)}', '${id(100)}', 4999, 'month', 'price_monthly1');
insert into public.product_prices (id, product_id, amount_pence) values
  ('${id(201)}', '${id(100)}', 9900),
  ('${id(202)}', '${id(101)}', 1000);
update public.products set active = true where id = '${id(100)}';
`);

const MONTHLY = id(200);
const FOR_GOOD = id(201);

const grant = (owner: string, pence: number, key: string, memo: string | null = null) =>
  one(`select * from public.ledger_grant_credit($1, $2, $3, $4)`, [owner, pence, key, memo]);
const buyWithCredit = (price: string, student: string, key: string) =>
  one(`select * from public.ledger_purchase_with_credit($1, $2, $3)`, [price, student, key]);
const cardPurchase = (
  payer: string,
  student: string,
  price: string,
  pence: number,
  ref: string,
  key: string,
  period: [string, string] | null = null,
) =>
  one(`select * from public.ledger_record_card_purchase($1, $2, $3, $4, $5, $6, null, $7, $8)`, [
    payer,
    student,
    price,
    pence,
    ref,
    key,
    period?.[0] ?? null,
    period?.[1] ?? null,
  ]);

console.log("commercial ledger:");

// --- Catalogue ----------------------------------------------------------------

await check("anon sees only products, modules and prices on sale", async () => {
  await as("anon", null, async () => {
    assert.deepEqual(
      (await rows(`select slug from public.products`)).map((r) => r.slug),
      ["alevel-biology-aqa"],
    );
    assert.equal(await count("public.product_modules"), 1);
    assert.equal(await count("public.product_prices"), 2);
  });
});

await check("clients can't write the catalogue", async () => {
  for (const role of ["anon", "authenticated"] as const) {
    await as(role, role === "anon" ? null : SELF, async () => {
      await assert.rejects(
        rows(
          `insert into public.products (slug, name, access_tier, active) values ('free', 'Free', 'standard', true)`,
        ),
        /permission denied/,
      );
      await assert.rejects(
        rows(`update public.product_prices set amount_pence = 1`),
        /permission denied/,
      );
    });
  }
});

await check(
  "a price never changes; it can only be switched off or given its Stripe id once",
  async () => {
    await db.exec(
      `insert into public.product_prices (id, product_id, amount_pence, billing_interval) values ('${id(203)}', '${id(101)}', 500, 'week')`,
    );
    await assert.rejects(
      rows(`update public.product_prices set amount_pence = 400 where id = '${id(203)}'`),
      /never changes/,
    );
    await assert.rejects(
      rows(`update public.product_prices set billing_interval = 'month' where id = '${id(203)}'`),
      /never changes/,
    );
    await rows(
      `update public.product_prices set stripe_price_id = 'price_week1' where id = '${id(203)}'`,
    );
    await assert.rejects(
      rows(
        `update public.product_prices set stripe_price_id = 'price_week2' where id = '${id(203)}'`,
      ),
      /never changes/,
    );
    await rows(`update public.product_prices set active = false where id = '${id(203)}'`);
  },
);

await check("one price on sale per product and billing pattern", async () => {
  await assert.rejects(
    rows(
      `insert into public.product_prices (product_id, amount_pence, billing_interval) values ('${id(100)}', 3999, 'month')`,
    ),
    /product_prices_one_active_idx/,
  );
  // A 30-day pass is its own pattern, so it can be on sale beside "for good".
  await rows(
    `insert into public.product_prices (id, product_id, amount_pence, access_days) values ('${id(204)}', '${id(100)}', 2500, 30)`,
  );
  await rows(`update public.product_prices set active = false where id = '${id(204)}'`);
});

// --- Credit and idempotency ---------------------------------------------------

await check("granting credit is service-role only", async () => {
  for (const role of ["anon", "authenticated"] as const) {
    await as(role, PARENT, async () => {
      await assert.rejects(grant(PARENT, 100000, "self-grant-0001"), /permission denied/);
    });
  }
});

await check(
  "same key + same request replays; same key + different request is refused",
  async () => {
    await as("service_role", null, async () => {
      const first = await grant(PARENT, 6000, "grant-parent-0001", "Welcome credit");
      assert.equal(first.replayed, false);
      assert.equal(Number(first.balance_pence), 6000);

      const again = await grant(PARENT, 6000, "grant-parent-0001", "Welcome credit");
      assert.equal(again.replayed, true);
      assert.equal(again.transaction_id, first.transaction_id);
      assert.equal(Number(again.balance_pence), 6000);

      await assert.rejects(
        grant(PARENT, 9000, "grant-parent-0001", "Welcome credit"),
        /different request/,
      );
      assert.equal(Number((await one(`select count(*)::int n from public.ledger_entries`)).n), 1);
    });
  },
);

await check("bad idempotency keys are refused", async () => {
  await as("service_role", null, async () => {
    await assert.rejects(grant(PARENT, 100, "short"), /idempotency_key/);
    await assert.rejects(grant(PARENT, 100, "has spaces in it"), /idempotency_key/);
  });
});

// --- Spending credit ----------------------------------------------------------

await check(
  "a parent spends credit on a linked child; the price is read from the database",
  async () => {
    await as("authenticated", PARENT, async () => {
      const r = await buyWithCredit(MONTHLY, CHILD, "buy-child-month-0001");
      assert.equal(Number(r.balance_pence), 6000 - 4999);
      const e = await one(`select * from public.product_entitlements where student_id = $1`, [
        CHILD,
      ]);
      assert.equal(e.is_current, true);
      assert.equal(e.product_id, id(100));
    });
    // The child sees the access, and none of the parent's payment rows.
    await as("authenticated", CHILD, async () => {
      const mine = await one(`select * from public.my_entitlements()`);
      assert.equal(mine.is_current, true);
      assert.equal(mine.student_id, CHILD);
      assert.ok(!("price_id" in mine) && !("account_id" in mine));
      assert.equal(await count("public.ledger_transactions"), 0);
      assert.equal(await count("public.product_entitlements"), 0);
    });
  },
);

await check("spending more credit than the account holds writes nothing", async () => {
  const before = await count("public.ledger_entries");
  await as("authenticated", PARENT, async () => {
    await assert.rejects(buyWithCredit(MONTHLY, CHILD, "buy-child-month-0002"), /enough credit/);
  });
  assert.equal(await count("public.ledger_entries"), before);
  assert.equal(
    await count("public.ledger_transactions where idempotency_key = 'client:buy-child-month-0002'"),
    0,
  );
});

await check("nobody buys for a child that isn't theirs, or for a tutor", async () => {
  await as("authenticated", PARENT, async () => {
    await assert.rejects(
      buyWithCredit(MONTHLY, STRANGER, "buy-stranger-0001"),
      /linked to your account/,
    );
  });
  await as("service_role", null, async () => {
    await grant(TUTOR, 10000, "grant-tutor-0001");
  });
  await as("authenticated", TUTOR, async () => {
    await assert.rejects(buyWithCredit(MONTHLY, TUTOR, "buy-tutor-0001"), /student account|tutor/i);
  });
});

await check("a product that isn't on sale isn't sold for credit", async () => {
  await as("service_role", null, async () => {
    await grant(STRANGER, 1000, "grant-stranger-0001");
  });
  await as("authenticated", STRANGER, async () => {
    await assert.rejects(buyWithCredit(id(202), STRANGER, "buy-draft-0001"), /on sale/);
  });
});

await check("clients can't call the service-role functions or the private helpers", async () => {
  await as("authenticated", SELF, async () => {
    await assert.rejects(
      cardPurchase(SELF, SELF, FOR_GOOD, 9900, "in_forged", "forged-card-0001"),
      /permission denied/,
    );
    await assert.rejects(
      rows(`select * from public.ledger_adjust($1, 100000, 'forged', 'forged-adjust-0001')`, [
        SELF,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      rows(`select * from public.ledger_refund($1, 'credit', 'forged-refund-0001')`, [id(999)]),
      /permission denied/,
    );
  });
  await as("service_role", null, async () => {
    await assert.rejects(
      rows(
        `select * from private.ledger_write($1, 'credit_grant', 'direct-write-0001', md5('x'), null, null, null, 100, null, null, null, null, null, '[{"type":"credit_grant","amount":100}]')`,
        [id(999)],
      ),
      /permission denied/,
    );
  });
});

// --- Card purchases -----------------------------------------------------------

let cardTx = "";
await check(
  "a card purchase records money in and the purchase out; the balance doesn't move",
  async () => {
    await as("service_role", null, async () => {
      const r = await cardPurchase(SELF, SELF, FOR_GOOD, 9900, "in_test0001", "stripe:evt_0001");
      cardTx = String(r.transaction_id);
      assert.equal(Number(r.balance_pence), 0);
      const e = await rows(
        `select entry_type, amount_pence, balance_after_pence from public.ledger_entries where transaction_id = $1 order by seq`,
        [cardTx],
      );
      assert.deepEqual(
        e.map((x) => [x.entry_type, x.amount_pence, Number(x.balance_after_pence)]),
        [
          ["card_payment", 9900, 9900],
          ["purchase", -9900, 0],
        ],
      );
      const again = await cardPurchase(
        SELF,
        SELF,
        FOR_GOOD,
        9900,
        "in_test0001",
        "stripe:evt_0001",
      );
      assert.equal(again.replayed, true);
    });
  },
);

await check(
  "one Stripe id is recorded once: under another key it replays or is refused",
  async () => {
    await as("service_role", null, async () => {
      const again = await cardPurchase(
        SELF,
        SELF,
        FOR_GOOD,
        9900,
        "in_test0001",
        "stripe:evt_0002",
      );
      assert.equal(again.replayed, true);
      assert.equal(again.transaction_id, cardTx);
      await assert.rejects(
        cardPurchase(SELF, SELF, FOR_GOOD, 9000, "in_test0001", "stripe:evt_0003"),
        /already recorded/,
      );
    });
    assert.equal(await count(`public.ledger_transactions where external_ref = 'in_test0001'`), 1);
  },
);

await check("a recurring card payment records the period Stripe charged for", async () => {
  await as("service_role", null, async () => {
    const jan = ["2026-01-31T10:00:00Z", "2026-02-28T10:00:00Z"] as [string, string];
    const first = await cardPurchase(
      STRANGER,
      STRANGER,
      MONTHLY,
      4999,
      "in_month01",
      "stripe:in_month01",
      jan,
    );
    // Anchored on the 31st: 28 Feb to 31 Mar is longer than one calendar month from the 28th.
    const feb = ["2026-02-28T10:00:00Z", "2026-03-31T10:00:00Z"] as [string, string];
    await cardPurchase(STRANGER, STRANGER, MONTHLY, 4999, "in_month02", "stripe:in_month02", feb);
    const w = await rows(
      `select access_starts_at, access_ends_at from public.ledger_transactions
       where external_ref in ('in_month01', 'in_month02') order by access_starts_at`,
    );
    assert.deepEqual(
      w.map((r) => [
        new Date(String(r.access_starts_at)).toISOString(),
        new Date(String(r.access_ends_at)).toISOString(),
      ]),
      [
        ["2026-01-31T10:00:00.000Z", "2026-02-28T10:00:00.000Z"],
        ["2026-02-28T10:00:00.000Z", "2026-03-31T10:00:00.000Z"],
      ],
    );

    // A caller's session time zone changes neither the dates nor the replay.
    await db.exec(`set timezone = 'Pacific/Kiritimati'`);
    try {
      const again = await cardPurchase(
        STRANGER,
        STRANGER,
        MONTHLY,
        4999,
        "in_month01",
        "stripe:in_month01",
        jan,
      );
      assert.equal(again.replayed, true);
      assert.equal(again.transaction_id, first.transaction_id);
    } finally {
      await db.exec(`reset timezone`);
    }

    await assert.rejects(
      cardPurchase(STRANGER, STRANGER, MONTHLY, 4999, "in_month03", "stripe:in_month03"),
      /billing period/,
    );
    await assert.rejects(
      cardPurchase(STRANGER, STRANGER, MONTHLY, 4999, "in_month04", "stripe:in_month04", [
        "2026-03-31T10:00:00Z",
        "2026-05-31T10:00:00Z",
      ]),
      /billing period/,
    );
    await assert.rejects(
      cardPurchase(STRANGER, STRANGER, FOR_GOOD, 9900, "in_once05", "stripe:in_once05", jan),
      /Only a recurring price/,
    );
  });
});

await check("a client's key can never block a key the service role needs", async () => {
  await as("service_role", null, async () => {
    await grant(SECOND, 30000, "grant-second-0001");
  });
  await as("authenticated", SECOND, async () => {
    await buyWithCredit(MONTHLY, SECOND, "stripe:in_squat0001");
  });
  await as("service_role", null, async () => {
    const r = await cardPurchase(
      SECOND,
      SECOND,
      FOR_GOOD,
      9900,
      "in_squat0001",
      "stripe:in_squat0001",
    );
    assert.equal(r.replayed, false);
    await assert.rejects(grant(SECOND, 100, "client:grant-0001"), /signed-in callers/);
  });
});

await check("a card payment is never above the price, and needs a Stripe id", async () => {
  await as("service_role", null, async () => {
    await assert.rejects(
      cardPurchase(SELF, SELF, MONTHLY, 5000, "in_test0003", "stripe:evt_0003"),
      /no more than the price/,
    );
    await assert.rejects(
      cardPurchase(SELF, SELF, MONTHLY, 0, "in_test0004", "stripe:evt_0004"),
      /more than nothing/,
    );
  });
});

await check("buying something you have for good again is refused", async () => {
  await as("service_role", null, async () => {
    await grant(SELF, 30000, "grant-self-0001");
  });
  await as("authenticated", SELF, async () => {
    await assert.rejects(buyWithCredit(FOR_GOOD, SELF, "buy-self-forgood-0001"), /for good/);
    // Nor a month of it: the credit would buy nothing.
    await assert.rejects(buyWithCredit(MONTHLY, SELF, "buy-self-month-0009"), /for good/);
  });
});

await check("renewing early starts the new period when the current one ends", async () => {
  // SECOND bought one month (above) and has the product for good by card;
  // refund the for-good purchase so months can be bought again.
  const forGood = String(
    (await one(`select id from public.ledger_transactions where external_ref = 'in_squat0001'`)).id,
  );
  await as("service_role", null, async () => {
    await rows(
      `select * from public.ledger_refund($1, 'card', 'refund-second-0001', 're_second01')`,
      [forGood],
    );
  });
  await as("authenticated", SECOND, async () => {
    await buyWithCredit(MONTHLY, SECOND, "buy-second-month-0001");
  });
  const w = await rows(
    `select access_starts_at, access_ends_at from public.ledger_transactions
     where student_id = $1 and price_id = $2 and kind = 'credit_purchase' order by access_starts_at`,
    [SECOND, MONTHLY],
  );
  assert.equal(w.length, 2);
  assert.equal(String(w[1].access_starts_at), String(w[0].access_ends_at));
});

// --- Refunds and adjustments --------------------------------------------------

await check("a refund to card reverses the purchase once and ends its access", async () => {
  await as("service_role", null, async () => {
    const before = await one(
      `select * from public.ledger_entries where account_id = (select id from public.billing_accounts where owner_id = $1) order by seq desc limit 1`,
      [SELF],
    );
    const r = await one(
      `select * from public.ledger_refund($1, 'card', 'refund-card-0001', 're_test0001')`,
      [cardTx],
    );
    assert.equal(Number(r.balance_pence), Number(before.balance_after_pence));
    await assert.rejects(
      rows(`select * from public.ledger_refund($1, 'credit', 'refund-card-0002')`, [cardTx]),
      /already been refunded/,
    );
    assert.equal(await count(`public.product_entitlements where purchase_id = '${cardTx}'`), 0);
  });
});

await check("a purchase paid with credit is refunded to credit, never to card", async () => {
  const childBuy = String(
    (
      await one(
        `select id from public.ledger_transactions where idempotency_key = 'client:buy-child-month-0001'`,
      )
    ).id,
  );
  await as("service_role", null, async () => {
    await assert.rejects(
      rows(`select * from public.ledger_refund($1, 'card', 'refund-child-0001', 're_test0002')`, [
        childBuy,
      ]),
      /refunded as credit/,
    );
    const r = await one(`select * from public.ledger_refund($1, 'credit', 'refund-child-0002')`, [
      childBuy,
    ]);
    assert.equal(Number(r.balance_pence), 6000);
  });
});

await check("an adjustment needs a reason and can't take the balance below zero", async () => {
  await as("service_role", null, async () => {
    await assert.rejects(
      rows(`select * from public.ledger_adjust($1, -999999, 'too much', 'adjust-parent-0001')`, [
        PARENT,
      ]),
      /enough credit/,
    );
    await assert.rejects(
      rows(`select * from public.ledger_adjust($1, -1, '  ', 'adjust-parent-0002')`, [PARENT]),
      /reason/,
    );
    const r = await one(
      `select * from public.ledger_adjust($1, -1, 'Rounding fix', 'adjust-parent-0003')`,
      [PARENT],
    );
    assert.equal(Number(r.balance_pence), 5999);
  });
});

// --- Immutability ---------------------------------------------------------------

await check(
  "the ledger can't be updated, deleted, truncated or hand-inserted, even by its owner",
  async () => {
    await assert.rejects(rows(`update public.ledger_entries set amount_pence = 1`), /append-only/);
    await assert.rejects(rows(`delete from public.ledger_transactions`), /append-only/);
    await assert.rejects(rows(`truncate public.ledger_entries`), /append-only/);
    await assert.rejects(rows(`truncate public.billing_accounts cascade`), /append-only/);
    await assert.rejects(
      rows(
        `insert into public.ledger_transactions (account_id, kind, idempotency_key, request_fingerprint, amount_pence)
       select id, 'credit_grant', 'hand-insert-0001', md5('x'), 100 from public.billing_accounts limit 1`,
      ),
      /only by the ledger functions/,
    );
  },
);

await check("no role but the owner holds a write privilege on the ledger", async () => {
  for (const [role, uid] of [
    ["service_role", null],
    ["authenticated", PARENT],
  ] as const) {
    await as(role, uid, async () => {
      await assert.rejects(
        rows(`update public.ledger_entries set amount_pence = 1`),
        /permission denied/,
      );
      await assert.rejects(rows(`delete from public.ledger_transactions`), /permission denied/);
      await assert.rejects(
        rows(`insert into public.billing_accounts (owner_id) values ($1)`, [STRANGER]),
        /permission denied/,
      );
      await assert.rejects(
        rows(`update public.billing_accounts set owner_id = $1`, [PARENT]),
        /permission denied/,
      );
    });
  }
  await as("anon", null, async () => {
    await assert.rejects(rows(`select * from public.ledger_entries`), /permission denied/);
    await assert.rejects(rows(`select * from public.product_entitlements`), /permission denied/);
  });
});

// --- Tenant isolation -----------------------------------------------------------

await check("each payer sees only their own account, transactions and entries", async () => {
  await as("authenticated", SELF, async () => {
    const accounts = await rows(`select owner_id from public.billing_accounts`);
    assert.deepEqual(
      accounts.map((a) => a.owner_id),
      [SELF],
    );
    const txOwners = await rows(
      `select distinct a.owner_id from public.ledger_transactions t join public.billing_accounts a on a.id = t.account_id`,
    );
    assert.deepEqual(
      txOwners.map((a) => a.owner_id),
      [SELF],
    );
    assert.ok((await count("public.ledger_entries")) > 0);
    assert.equal(
      await count(
        `public.ledger_entries e where e.account_id not in (select id from public.billing_accounts)`,
      ),
      0,
    );
  });
  await as("authenticated", STRANGER, async () => {
    assert.ok((await count("public.ledger_transactions")) > 0); // their own
    assert.equal(
      await count(
        `public.ledger_transactions t where t.account_id not in (select id from public.billing_accounts)`,
      ),
      0,
    );
    assert.equal(await count(`public.ledger_transactions where student_id = '${CHILD}'`), 0);
  });
});

await check(
  "a covered child never sees the family's payments or balance; a refund ends their access",
  async () => {
    await as("authenticated", CHILD, async () => {
      assert.equal(await count("public.ledger_transactions"), 0);
      assert.equal(await count("public.my_entitlements()"), 0); // refunded above
      assert.equal(await count("public.ledger_entries"), 0);
      assert.equal(await count("public.billing_accounts"), 0);
      assert.equal(Number((await one(`select public.my_credit_balance() as b`)).b), 0);
    });
    await as("authenticated", PARENT, async () => {
      assert.equal(Number((await one(`select public.my_credit_balance() as b`)).b), 5999);
    });
  },
);

// --- Catalogue after a sale -------------------------------------------------------

await check("a sold product keeps its modules; adding one is fine", async () => {
  await assert.rejects(
    rows(`delete from public.product_modules where product_id = '${id(100)}'`),
    /never taken away/,
  );
  await assert.rejects(
    rows(`update public.product_modules set board = 'ocr' where product_id = '${id(100)}'`),
    /never taken away/,
  );
  await rows(
    `insert into public.product_modules (product_id, level, subject, board) values ('${id(100)}', 'alevel', 'chemistry', 'aqa')`,
  );
  await assert.rejects(
    rows(`delete from public.products where id = '${id(100)}'`),
    /never taken away|violates foreign key/,
  );
});

await check("student_has_module follows current, unrefunded purchases", async () => {
  const has = async (student: string, board: string, subject = "biology") =>
    (
      await one(
        `select private.student_has_module($1, 'alevel', $3::public.subject, $2::public.board) as ok`,
        [student, board, subject],
      )
    ).ok;
  assert.equal(await has(SECOND, "aqa"), true); // the credit-bought month
  assert.equal(await has(SECOND, "ocr"), false); // module is AQA only
  assert.equal(await has(SECOND, "aqa", "chemistry"), true); // module added after the sale
  assert.equal(await has(SELF, "aqa"), false); // for good, refunded to card
  assert.equal(await has(CHILD, "aqa"), false); // refunded
  assert.equal(await has(STRANGER, "aqa"), false); // card months in the past
});

// --- Account deletion ------------------------------------------------------------

await check("deleting a payer closes their account and keeps its history", async () => {
  const entriesBefore = await count("public.ledger_entries");
  await rows(`delete from public.profiles where id = $1`, [SECOND]);
  const acct = await one(`select * from public.billing_accounts where owner_id is null`);
  assert.ok(acct.closed_at);
  assert.equal(await count("public.ledger_entries"), entriesBefore);
  await assert.rejects(
    rows(`update public.billing_accounts set owner_id = $1 where id = $2`, [PARENT, acct.id]),
    /never changes hands/,
  );
  const month = String(
    (
      await one(
        `select id from public.ledger_transactions where idempotency_key = 'client:buy-second-month-0001'`,
      )
    ).id,
  );
  await as("service_role", null, async () => {
    await assert.rejects(
      rows(`select * from public.ledger_refund($1, 'credit', 'refund-closed-0001')`, [month]),
      /account is closed/,
    );
  });
});

await check("the audit finds nothing wrong", async () => {
  assert.deepEqual(await rows(`select * from private.ledger_audit()`), []);
});

// --- TypeScript mirrors the CHECK constraints ---------------------------------

await check("commerce.ts lists match the database's CHECK constraints", async () => {
  const quoted = async (constraint: string) => {
    const def = String(
      (
        await one(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = $1`, [
          constraint,
        ])
      ).d,
    );
    return [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual(
    await quoted("ledger_transactions_kind_check"),
    [...LEDGER_TRANSACTION_KINDS].sort(),
  );
  assert.deepEqual(await quoted("ledger_entries_entry_type_check"), [...LEDGER_ENTRY_TYPES].sort());
  assert.deepEqual(
    await quoted("product_prices_billing_interval_check"),
    [...BILLING_INTERVALS].sort(),
  );
});

// --- Rollback -------------------------------------------------------------------

await check(
  "the rollback removes every object, and the migration applies again after it",
  async () => {
    const rollback = await readFile(
      new URL("../supabase/rollbacks/20261108120000_commercial_ledger.down.sql", import.meta.url),
      "utf8",
    );
    const leftovers = () =>
      rows(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in (
        'access_tiers', 'products', 'product_modules', 'product_prices',
        'billing_accounts', 'ledger_transactions', 'ledger_entries', 'product_entitlements')
      union all
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where (n.nspname = 'public' and (p.proname like 'ledger\\_%' or p.proname in ('my_credit_balance', 'my_entitlements')))
         or (n.nspname = 'private' and (p.proname like 'ledger\\_%' or p.proname in (
           'student_has_module', 'billing_account_guard', 'product_module_guard',
           'product_price_guard', 'commerce_touch_updated_at')))`);
    await db.exec(rollback);
    assert.deepEqual(await leftovers(), []);
    await db.exec(migration);
    assert.equal((await leftovers()).length, 8 + 24);
  },
);

console.log(`\n${passed} checks passed.`);
