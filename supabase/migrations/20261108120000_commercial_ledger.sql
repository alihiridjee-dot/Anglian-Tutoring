-- Products catalogue and an append-only money ledger.
--
-- ADDITIVE AND DARK. Nothing in the app, the paywall or the Stripe webhook
-- reads or writes anything here yet. Today's plans (`packages`) and today's
-- access (`subscriptions`, written only by stripe-webhook, read by
-- private.student_has_access) are not touched. Wiring this in comes later, one
-- PR at a time.
--
-- What it adds
--
--   Catalogue   access_tiers, products, product_modules, product_prices.
--               A product unlocks content modules. A module is a level and a
--               subject, optionally one board, keyed by the same enums as
--               `topics`, so "A-level Biology, AQA" is one row.
--   Accounts    billing_accounts. One per payer (a student who pays for
--               themselves, or a parent). This is the tenant: every ledger row
--               carries its account, and every read is scoped to it.
--   Ledger      ledger_transactions (one row per request: the who, what and
--               the idempotency key) and ledger_entries (the money movements,
--               numbered 1, 2, 3 per account, each carrying the balance after
--               it). Both are append-only.
--   Access      product_entitlements: a view of the purchases that have not
--               been refunded, with the access window each one bought.
--
-- What a balance means
--
--   An account's balance is store credit: money the business holds for that
--   family, in pence, never below zero. A card payment that buys a product
--   posts +X (card_payment) then -X (purchase), so it nets to zero. Spending
--   credit posts -X (purchase) alone. A refund posts +X (refund) back to
--   credit, followed by -X (card_refund) when the money goes back to the card.
--
-- The rules the database enforces, whoever is connected
--
--   1. Nobody writes the ledger tables directly. Not anon, not authenticated,
--      not the service role: they have SELECT only. Every row is written by
--      the SECURITY DEFINER functions at the bottom, and an insert trigger
--      refuses any row that did not come through them.
--   2. Nothing in the ledger is ever updated, deleted or truncated. Triggers
--      refuse it even for the table owner. A mistake is corrected by a new
--      refund or adjustment, so the history stays true.
--   3. One idempotency key per account means one transaction. Sending the same
--      key with the same request returns the first result (replayed = true);
--      the same key with a different request is refused. A Stripe id
--      (external_ref) is recorded once only: sent again under another key,
--      the same payment replays and anything else is refused. Keys from
--      signed-in callers are stored as 'client:<key>', and the service-role
--      functions refuse that prefix, so a client can never take a key the
--      webhook will need.
--   4. Postings on one account are serialised by a row lock on the account, so
--      two requests at once can't both spend the same credit. Purchases and
--      refunds also take a lock on the student and product, so two payers
--      buying for one child at once queue rather than overlap.
--   5. A price never changes once made (as in Stripe): switch it off and add
--      a new one. A product that has been sold keeps all its modules.
--   6. Clients may spend their own credit, for themselves or a linked child,
--      and nothing else. Recording card payments, granting credit, refunds and
--      adjustments are for the service role only (edge functions, scripts).
--
-- Account deletion: deleting a profile leaves its billing account in place with
-- owner_id set to null and closed_at stamped, and its ledger rows untouched.
-- Payment records are kept (UK tax records run six years). They carry no
-- names, emails or free text from the family: only amounts, product ids and
-- the bare uuid of the student a purchase covered. That uuid is the residual
-- exposure; it matches nothing in this database once the profile is gone, but
-- Stripe metadata holds the same id.
--
-- Tutors are never students: purchases refuse a staff account as the student
-- they cover. The student_row_not_staff trigger is deliberately not attached
-- here, because its rule 4 asks for a promoted account's rows to be deleted,
-- and ledger rows can never be deleted.

-- ===========================================================================
-- Catalogue
-- ===========================================================================

create table public.access_tiers (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  -- Higher rank includes everything a lower one does.
  rank smallint not null unique check (rank >= 0),
  description text check (description is null or length(description) <= 500),
  created_at timestamptz not null default now()
);

comment on table public.access_tiers is
  'Levels of access a product can grant. Higher rank includes the lower ones.';

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 2000),
  access_tier text not null
    references public.access_tiers (code) on update cascade on delete restrict,
  -- Off by default, so a product is never on sale before it has its modules
  -- and a price.
  active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.products is
  'What can be bought. Unlocks the content modules in product_modules.';

create table public.product_modules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  level public.level not null,
  subject public.subject not null,
  -- null means every board at this level.
  board public.board,
  created_at timestamptz not null default now(),
  constraint product_modules_unique unique nulls not distinct (product_id, level, subject, board)
);

create index product_modules_lookup_idx on public.product_modules (level, subject, board);

comment on table public.product_modules is
  'The content a product unlocks: a level and subject, optionally one board (null = any board).';

create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  currency text not null default 'GBP' check (currency = 'GBP'),
  amount_pence integer not null check (amount_pence > 0 and amount_pence <= 1000000),
  -- Recurring: one billing period of access per payment.
  billing_interval text check (billing_interval in ('week', 'month', 'quarter', 'year')),
  -- One-off with an end: this many days of access. Both null: one-off, for good.
  access_days integer check (access_days > 0 and access_days <= 3660),
  stripe_price_id text unique check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint product_prices_one_length check (billing_interval is null or access_days is null)
);

-- One price on sale per product and billing pattern (each interval, each length
-- of pass, and for good are separate patterns).
create unique index product_prices_one_active_idx
  on public.product_prices (product_id, coalesce(billing_interval, 'days:' || access_days, 'for_good'))
  where active;

comment on table public.product_prices is
  'What a product costs, in pence. Never edited once made: switch it off and add a new one.';

-- --- Catalogue guards ------------------------------------------------------

create or replace function private.commerce_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function private.commerce_touch_updated_at();

-- Prices are immutable, as they are in Stripe. Ledger rows point at a price, so
-- editing one would rewrite what every past buyer paid. Only `active` may move,
-- and stripe_price_id may be filled in once (the seed script does that).
create or replace function private.product_price_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_id is distinct from old.product_id
     or new.currency is distinct from old.currency
     or new.amount_pence is distinct from old.amount_pence
     or new.billing_interval is distinct from old.billing_interval
     or new.access_days is distinct from old.access_days
     or new.created_at is distinct from old.created_at
     or (old.stripe_price_id is not null and new.stripe_price_id is distinct from old.stripe_price_id)
  then
    raise exception 'A price never changes once it is made.'
      using errcode = '23514',
            hint = 'Switch this price off and add a new one.';
  end if;
  return new;
end;
$$;

create trigger product_prices_guard
  before update on public.product_prices
  for each row execute function private.product_price_guard();

-- A product that has been sold keeps every module it was sold with. Adding a
-- module only gives buyers more, so that stays allowed.
create or replace function private.product_module_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.ledger_transactions t
    where t.product_id = old.product_id
      and t.kind in ('card_purchase', 'credit_purchase')
  ) then
    raise exception 'This product has been sold, so its modules can be added to but never taken away.'
      using errcode = '23514',
            hint = 'Make a new product for a smaller bundle.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- Accounts and the ledger
-- ===========================================================================

create table public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  -- The payer. Set to null when their profile is deleted; the history stays.
  owner_id uuid unique references public.profiles (id) on delete set null,
  currency text not null default 'GBP' check (currency = 'GBP'),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

comment on table public.billing_accounts is
  'One per payer: the tenant every ledger row belongs to. Balance = the last ledger entry''s balance_after_pence.';

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts (id) on delete restrict,
  kind text not null
    check (kind in ('card_purchase', 'credit_purchase', 'credit_grant', 'refund', 'adjustment')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:._-]{8,200}$'),
  -- md5 of the request's own parameters, to tell a replay from a reused key.
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{32}$'),
  -- The student a purchase covers. No foreign key on purpose: the row must
  -- outlive the profile, and an ON DELETE SET NULL would be an UPDATE, which
  -- the ledger refuses. The posting functions check it exists when written.
  student_id uuid,
  product_id uuid references public.products (id) on delete restrict,
  price_id uuid references public.product_prices (id) on delete restrict,
  -- The transaction's value: what was paid, granted, refunded or adjusted by.
  amount_pence integer not null check (amount_pence > 0),
  reverses_transaction_id uuid unique
    references public.ledger_transactions (id) on delete restrict,
  -- A Stripe id (in_…, pi_…, re_…). Recorded once only, whatever the key.
  external_ref text unique check (external_ref ~ '^[A-Za-z0-9_-]{3,255}$'),
  memo text check (memo is null or length(memo) <= 280),
  -- The access a purchase bought: [starts, ends). ends null = for good.
  access_starts_at timestamptz,
  access_ends_at timestamptz,
  -- auth.uid() of a signed-in caller; null when the service role posted it.
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint ledger_transactions_key_per_account unique (account_id, idempotency_key),
  constraint ledger_transactions_window check (
    access_ends_at is null or access_ends_at > access_starts_at
  ),
  constraint ledger_transactions_shape check (
    case kind
      when 'card_purchase' then
        student_id is not null and product_id is not null and price_id is not null
        and external_ref is not null and reverses_transaction_id is null
        and access_starts_at is not null
      when 'credit_purchase' then
        student_id is not null and product_id is not null and price_id is not null
        and reverses_transaction_id is null and access_starts_at is not null
      when 'refund' then
        reverses_transaction_id is not null
        and access_starts_at is null and access_ends_at is null
      when 'credit_grant' then
        product_id is null and price_id is null and reverses_transaction_id is null
        and access_starts_at is null and access_ends_at is null
      when 'adjustment' then
        product_id is null and price_id is null and reverses_transaction_id is null
        and access_starts_at is null and access_ends_at is null and memo is not null
    end
  )
);

create index ledger_transactions_account_idx on public.ledger_transactions (account_id, created_at desc);
create index ledger_transactions_student_idx on public.ledger_transactions (student_id, product_id)
  where student_id is not null;
create index ledger_transactions_product_idx on public.ledger_transactions (product_id)
  where product_id is not null;
create index ledger_transactions_price_idx on public.ledger_transactions (price_id)
  where price_id is not null;

comment on table public.ledger_transactions is
  'Append-only. One row per request, keyed by (account_id, idempotency_key). Written only by the ledger_* functions.';

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.ledger_transactions (id) on delete restrict,
  account_id uuid not null references public.billing_accounts (id) on delete restrict,
  -- 1, 2, 3 … per account, with no gaps.
  seq integer not null check (seq > 0),
  entry_type text not null
    check (entry_type in ('card_payment', 'purchase', 'credit_grant', 'refund', 'card_refund', 'adjustment')),
  amount_pence integer not null check (amount_pence <> 0),
  balance_after_pence bigint not null check (balance_after_pence >= 0),
  created_at timestamptz not null default now(),
  constraint ledger_entries_seq_unique unique (account_id, seq),
  constraint ledger_entries_sign check (
    case entry_type
      when 'card_payment' then amount_pence > 0
      when 'credit_grant' then amount_pence > 0
      when 'refund' then amount_pence > 0
      when 'purchase' then amount_pence < 0
      when 'card_refund' then amount_pence < 0
      when 'adjustment' then true
    end
  )
);

create index ledger_entries_transaction_idx on public.ledger_entries (transaction_id);

comment on table public.ledger_entries is
  'Append-only money movements on an account. Signed pence; balance_after_pence is the running store-credit balance.';

-- Now that ledger_transactions exists, the module guard can be attached.
create trigger product_modules_guard
  before update or delete on public.product_modules
  for each row execute function private.product_module_guard();

-- --- Immutability ----------------------------------------------------------

create or replace function private.ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The ledger is append-only, so % on % is refused.', lower(tg_op), tg_table_name
    using errcode = '42501',
          hint = 'Correct a mistake with a new refund or adjustment.';
  return null;
end;
$$;

-- Rows reach the ledger only through private.ledger_write, which sets this
-- flag for the length of its own insert. It is a guard against hand-written
-- inserts that would skip the numbering and the balance, not a secret: no role
-- but the owner can insert into these tables at all.
create or replace function private.ledger_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.ledger_posting', true), '') <> 'on' then
    raise exception 'Ledger rows are written only by the ledger functions.'
      using errcode = '42501',
            hint = 'Call ledger_record_card_purchase, ledger_purchase_with_credit, ledger_grant_credit, ledger_refund or ledger_adjust.';
  end if;
  return new;
end;
$$;

create trigger ledger_transactions_insert_guard
  before insert on public.ledger_transactions
  for each row execute function private.ledger_insert_guard();
create trigger ledger_transactions_append_only
  before update or delete on public.ledger_transactions
  for each row execute function private.ledger_append_only();
create trigger ledger_transactions_no_truncate
  before truncate on public.ledger_transactions
  for each statement execute function private.ledger_append_only();

create trigger ledger_entries_insert_guard
  before insert on public.ledger_entries
  for each row execute function private.ledger_insert_guard();
create trigger ledger_entries_append_only
  before update or delete on public.ledger_entries
  for each row execute function private.ledger_append_only();
create trigger ledger_entries_no_truncate
  before truncate on public.ledger_entries
  for each statement execute function private.ledger_append_only();

-- A billing account never changes hands. The one update allowed is the one a
-- deleted profile makes through ON DELETE SET NULL, and that closes it.
create or replace function private.billing_account_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.owner_id is not null and new.owner_id is null
     and new.id = old.id
     and new.currency = old.currency
     and new.created_at = old.created_at
  then
    new.closed_at := coalesce(old.closed_at, now());
    return new;
  end if;
  raise exception 'A billing account never changes hands or currency.'
    using errcode = '42501';
end;
$$;

create trigger billing_accounts_guard
  before update on public.billing_accounts
  for each row execute function private.billing_account_guard();

create trigger billing_accounts_no_truncate
  before truncate on public.billing_accounts
  for each statement execute function private.ledger_append_only();

-- ===========================================================================
-- Who can see what
-- ===========================================================================

-- Supabase grants every new table to anon, authenticated and service_role by
-- default. Start from nothing and give back reads only.
revoke all on table
  public.access_tiers, public.products, public.product_modules, public.product_prices,
  public.billing_accounts, public.ledger_transactions, public.ledger_entries
from public, anon, authenticated;

-- The catalogue is public (the pricing page is), but only what is on sale.
-- The service role keeps its default write access to the catalogue, for the
-- seed script and SQL; there is no client write path.
grant select on table
  public.access_tiers, public.products, public.product_modules, public.product_prices
to anon, authenticated;

-- The ledger: reads only, for everyone. Writes go through the functions.
revoke all on table public.billing_accounts, public.ledger_transactions, public.ledger_entries
  from service_role;
grant select on table public.billing_accounts, public.ledger_transactions, public.ledger_entries
  to authenticated, service_role;

alter table public.access_tiers enable row level security;
alter table public.products enable row level security;
alter table public.product_modules enable row level security;
alter table public.product_prices enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;

create policy "access tiers are public" on public.access_tiers
  for select to anon, authenticated
  using (true);

create policy "products on sale are public" on public.products
  for select to anon, authenticated
  using (active);

create policy "modules of products on sale are public" on public.product_modules
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.active));

create policy "prices on sale are public" on public.product_prices
  for select to anon, authenticated
  using (active and exists (select 1 from public.products p where p.id = product_id and p.active));

-- An account is seen by its owner only.
create policy "billing account owner reads" on public.billing_accounts
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- A transaction is seen by the account owner only. Its row carries what the
-- payer paid, the Stripe id and any memo, which are the payer's business; a
-- child a parent bought for sees their access through my_entitlements().
create policy "ledger transactions owner reads" on public.ledger_transactions
  for select to authenticated
  using (
    account_id in (select a.id from public.billing_accounts a where a.owner_id = (select auth.uid()))
  );

-- Entries carry the account's running balance, so only the owner sees them.
create policy "ledger entries owner reads" on public.ledger_entries
  for select to authenticated
  using (
    account_id in (select a.id from public.billing_accounts a where a.owner_id = (select auth.uid()))
  );

-- What each unrefunded purchase gives access to. security_invoker, so the
-- ledger_transactions policy above decides which rows a caller sees.
create view public.product_entitlements
with (security_invoker = true)
as
select
  t.id as purchase_id,
  t.account_id,
  t.student_id,
  t.product_id,
  t.price_id,
  t.access_starts_at as starts_at,
  t.access_ends_at as ends_at,
  t.created_at as purchased_at,
  (t.access_starts_at <= now() and (t.access_ends_at is null or t.access_ends_at > now())) as is_current
from public.ledger_transactions t
where t.kind in ('card_purchase', 'credit_purchase')
  and not exists (
    select 1 from public.ledger_transactions r where r.reverses_transaction_id = t.id
  );

revoke all on table public.product_entitlements from public, anon, authenticated, service_role;
grant select on table public.product_entitlements to authenticated, service_role;

-- ===========================================================================
-- Internal helpers (private, no grants: only the functions below call them)
-- ===========================================================================

-- The payer's billing account, created if need be, locked FOR UPDATE until the
-- caller's transaction ends. Every posting takes this lock first, so postings
-- on one account run one at a time.
create or replace function private.ledger_lock_account(p_owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  if p_owner_id is null
     or not exists (select 1 from public.profiles p where p.id = p_owner_id)
  then
    raise exception 'There is no account to bill.' using errcode = '22023';
  end if;

  insert into public.billing_accounts (owner_id) values (p_owner_id)
  on conflict (owner_id) do nothing;

  select a.id into _id
  from public.billing_accounts a
  where a.owner_id = p_owner_id
  for update;

  -- Only if the profile was deleted between the check and the lock.
  if _id is null then
    raise exception 'There is no account to bill.' using errcode = '22023';
  end if;

  return _id;
end;
$$;

-- Service-role keys may not use the prefix kept for signed-in callers.
create or replace function private.ledger_service_key(p_key text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_key like 'client:%' then
    raise exception 'Keys starting "client:" belong to signed-in callers.' using errcode = '22023';
  end if;
  return p_key;
end;
$$;

-- How long one payment of a price lasts; null means for good.
create or replace function private.ledger_period_length(p_billing_interval text, p_access_days integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case p_billing_interval
      when 'week' then interval '7 days'
      when 'month' then interval '1 month'
      when 'quarter' then interval '3 months'
      when 'year' then interval '1 year'
    end,
    case when p_access_days is not null then make_interval(days => p_access_days) end
  );
$$;

-- Queues purchases and refunds for one student and product, whoever pays, so
-- the access window and the "already has it for good" check can't race. Taken
-- after the account lock, always in that order, so it can't deadlock.
create or replace function private.ledger_lock_student_product(p_student_id uuid, p_product_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ledger:' || p_student_id::text || ':' || p_product_id::text, 0)
  );
$$;

create or replace function private.ledger_balance(p_account_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.balance_after_pence
     from public.ledger_entries e
     where e.account_id = p_account_id
     order by e.seq desc
     limit 1),
    0
  );
$$;

-- The earlier result for this key, if there is one. Same key, same request:
-- hand back what happened the first time. Same key, different request: refuse.
create or replace function private.ledger_replay(p_account_id uuid, p_key text, p_fingerprint text)
returns table (transaction_id uuid, balance_pence bigint, replayed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _id uuid;
  _fingerprint text;
begin
  select t.id, t.request_fingerprint into _id, _fingerprint
  from public.ledger_transactions t
  where t.account_id = p_account_id and t.idempotency_key = p_key;

  if _id is null then
    return;
  end if;

  if _fingerprint <> p_fingerprint then
    raise exception 'This request key has already been used for a different request.'
      using errcode = '22023',
            hint = 'Send a new idempotency key for a new request.';
  end if;

  return query
  select _id,
         (select e.balance_after_pence from public.ledger_entries e
          where e.transaction_id = _id order by e.seq desc limit 1),
         true;
end;
$$;

-- A purchase covers a real student account, never a tutor's.
create or replace function private.ledger_check_student(p_student_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_student_id is null
     or not exists (select 1 from public.profiles p where p.id = p_student_id and p.role = 'student')
  then
    raise exception 'A purchase has to cover a student account.' using errcode = '22023';
  end if;
  if private.is_staff(p_student_id) then
    raise exception 'Tutors are never students, so a purchase can''t cover a tutor account.'
      using errcode = '22023';
  end if;
end;
$$;

-- The access window a new purchase buys. A time-limited purchase starts when
-- the student's current access to the same product ends, so renewing early
-- never wastes days. A purchase for good starts now and never ends.
create or replace function private.ledger_access_window(
  p_student_id uuid, p_product_id uuid, p_billing_interval text, p_access_days integer
)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
#variable_conflict use_column
declare
  _length interval := private.ledger_period_length(p_billing_interval, p_access_days);
  _from timestamptz;
begin
  if _length is null then
    return query select now(), null::timestamptz;
    return;
  end if;

  select greatest(now(), coalesce(max(t.access_ends_at), now())) into _from
  from public.ledger_transactions t
  where t.student_id = p_student_id
    and t.product_id = p_product_id
    and t.kind in ('card_purchase', 'credit_purchase')
    and t.access_ends_at > now()
    and not exists (
      select 1 from public.ledger_transactions r where r.reverses_transaction_id = t.id
    );

  return query select _from, _from + _length;
end;
$$;

-- Writes one transaction and its entries, numbering them and carrying the
-- balance forward. The caller must already hold the account lock
-- (private.ledger_lock_account) and have checked for a replay.
-- p_entries: [{"type": "<entry_type>", "amount": <signed pence>}, …] in order.
create or replace function private.ledger_write(
  p_account_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_fingerprint text,
  p_student_id uuid,
  p_product_id uuid,
  p_price_id uuid,
  p_amount_pence integer,
  p_reverses_transaction_id uuid,
  p_external_ref text,
  p_memo text,
  p_access_starts_at timestamptz,
  p_access_ends_at timestamptz,
  p_entries jsonb
)
returns table (transaction_id uuid, balance_pence bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _tx uuid := gen_random_uuid();
  _balance bigint := private.ledger_balance(p_account_id);
  _seq integer;
  _entry jsonb;
  _amount integer;
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'A transaction needs at least one entry.' using errcode = '22023';
  end if;

  select coalesce(max(e.seq), 0) into _seq
  from public.ledger_entries e
  where e.account_id = p_account_id;

  perform set_config('app.ledger_posting', 'on', true);

  insert into public.ledger_transactions (
    id, account_id, kind, idempotency_key, request_fingerprint,
    student_id, product_id, price_id, amount_pence, reverses_transaction_id,
    external_ref, memo, access_starts_at, access_ends_at, created_by
  ) values (
    _tx, p_account_id, p_kind, p_idempotency_key, p_fingerprint,
    p_student_id, p_product_id, p_price_id, p_amount_pence, p_reverses_transaction_id,
    p_external_ref, p_memo, p_access_starts_at, p_access_ends_at, auth.uid()
  );

  for _entry in select value from jsonb_array_elements(p_entries) loop
    _amount := (_entry ->> 'amount')::integer;
    _seq := _seq + 1;
    _balance := _balance + _amount;
    if _balance < 0 then
      raise exception 'There isn''t enough credit on this account for that.'
        using errcode = '23514';
    end if;
    insert into public.ledger_entries (
      transaction_id, account_id, seq, entry_type, amount_pence, balance_after_pence
    ) values (
      _tx, p_account_id, _seq, _entry ->> 'type', _amount, _balance
    );
  end loop;

  perform set_config('app.ledger_posting', 'off', true);

  return query select _tx, _balance, false;
end;
$$;

-- Does this student hold current access to this module? Unused for now; it is
-- what content RLS will call once purchases unlock content. No grants yet.
create or replace function private.student_has_module(
  p_student_id uuid, p_level public.level, p_subject public.subject, p_board public.board
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ledger_transactions t
    join public.product_modules m on m.product_id = t.product_id
    where t.student_id = p_student_id
      and t.kind in ('card_purchase', 'credit_purchase')
      and t.access_starts_at <= now()
      and (t.access_ends_at is null or t.access_ends_at > now())
      and not exists (
        select 1 from public.ledger_transactions r where r.reverses_transaction_id = t.id
      )
      and m.level = p_level
      and m.subject = p_subject
      and (m.board is null or m.board = p_board)
  );
$$;

-- Checks every account's history adds up: entries numbered 1..n with no gaps,
-- each balance_after equal to the running sum, every transaction with entries
-- on its own account. Returns one row per problem; no rows means it is sound.
create or replace function private.ledger_audit(p_account_id uuid default null)
returns table (account_id uuid, seq integer, problem text)
language sql
stable
security definer
set search_path = ''
as $$
  with e as (
    select
      x.account_id,
      x.seq,
      x.balance_after_pence,
      row_number() over w as n,
      sum(x.amount_pence) over w as running
    from public.ledger_entries x
    where p_account_id is null or x.account_id = p_account_id
    window w as (partition by x.account_id order by x.seq rows between unbounded preceding and current row)
  )
  select e.account_id, e.seq, 'entries are not numbered 1, 2, 3 without gaps' from e where e.seq <> e.n
  union all
  select e.account_id, e.seq, 'balance_after does not match the running sum' from e where e.running <> e.balance_after_pence
  union all
  select t.account_id, null::integer, 'transaction ' || t.id || ' has no entries'
  from public.ledger_transactions t
  where (p_account_id is null or t.account_id = p_account_id)
    and not exists (select 1 from public.ledger_entries x where x.transaction_id = t.id)
  union all
  select x.account_id, x.seq, 'entry is on a different account from its transaction'
  from public.ledger_entries x
  join public.ledger_transactions t on t.id = x.transaction_id
  where t.account_id <> x.account_id
    and (p_account_id is null or x.account_id = p_account_id);
$$;

revoke all on function
  private.commerce_touch_updated_at(),
  private.product_price_guard(),
  private.product_module_guard(),
  private.ledger_append_only(),
  private.ledger_insert_guard(),
  private.billing_account_guard(),
  private.ledger_lock_account(uuid),
  private.ledger_service_key(text),
  private.ledger_period_length(text, integer),
  private.ledger_lock_student_product(uuid, uuid),
  private.ledger_balance(uuid),
  private.ledger_replay(uuid, text, text),
  private.ledger_check_student(uuid),
  private.ledger_access_window(uuid, uuid, text, integer),
  private.ledger_write(uuid, text, text, text, uuid, uuid, uuid, integer, uuid, text, text, timestamptz, timestamptz, jsonb),
  private.student_has_module(uuid, public.level, public.subject, public.board),
  private.ledger_audit(uuid)
from public, anon, authenticated, service_role;

-- ===========================================================================
-- The transaction functions (the only way in)
-- ===========================================================================
--
-- Each returns (transaction_id, balance_pence, replayed): the transaction
-- written (or the earlier one, on a replay) and the account's balance just
-- after it. Each runs as one database transaction: it all lands or none of it
-- does. lock_timeout stops a stuck lock from hanging a caller; timezone UTC
-- keeps date arithmetic and request fingerprints the same whatever time zone
-- the caller's session asked for.

-- --- Clients: spend your own credit, see your own access -------------------

-- A signed-in payer spends their store credit on a product, for themselves or a
-- child linked to them. The price is read here, never taken from the caller.
-- The key is stored as 'client:<key>' (rule 3 in the header).
create or replace function public.ledger_purchase_with_credit(
  p_price_id uuid,
  p_student_id uuid,
  p_idempotency_key text
)
returns table (transaction_id uuid, balance_pence bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set timezone = 'UTC'
as $$
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _key text := 'client:' || p_idempotency_key;
  _account uuid;
  _fingerprint text := md5(jsonb_build_object(
    'op', 'credit_purchase', 'price', p_price_id, 'student', p_student_id
  )::text);
  _price record;
  _starts timestamptz;
  _ends timestamptz;
begin
  if _uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9:._-]{8,190}$' then
    raise exception 'A request key is 8 to 190 letters, digits, dots, colons, dashes or underscores.'
      using errcode = '22023';
  end if;
  if p_student_id is distinct from _uid and not exists (
    select 1 from public.parent_student_links l
    where l.parent_id = _uid and l.student_id = p_student_id
  ) then
    raise exception 'You can buy for yourself or for a child linked to your account.'
      using errcode = '42501';
  end if;

  _account := private.ledger_lock_account(_uid);

  return query select * from private.ledger_replay(_account, _key, _fingerprint);
  if found then
    return;
  end if;

  perform private.ledger_check_student(p_student_id);

  select pp.id, pp.product_id, pp.amount_pence, pp.billing_interval, pp.access_days
    into _price
  from public.product_prices pp
  join public.products pr on pr.id = pp.product_id
  where pp.id = p_price_id and pp.active and pr.active;
  if not found then
    raise exception 'That isn''t on sale any more.' using errcode = '22023';
  end if;

  perform private.ledger_lock_student_product(p_student_id, _price.product_id);

  -- Whatever price is being bought: a student who has it for good gains
  -- nothing from buying it again.
  if exists (
    select 1 from public.ledger_transactions t
    where t.student_id = p_student_id
      and t.product_id = _price.product_id
      and t.kind in ('card_purchase', 'credit_purchase')
      and t.access_ends_at is null
      and not exists (
        select 1 from public.ledger_transactions r where r.reverses_transaction_id = t.id
      )
  ) then
    raise exception 'This student already has that for good.' using errcode = '23505';
  end if;

  select w.starts_at, w.ends_at into _starts, _ends
  from private.ledger_access_window(
    p_student_id, _price.product_id, _price.billing_interval, _price.access_days
  ) w;

  return query
  select * from private.ledger_write(
    _account, 'credit_purchase', _key, _fingerprint,
    p_student_id, _price.product_id, _price.id, _price.amount_pence,
    null, null, null, _starts, _ends,
    jsonb_build_array(jsonb_build_object('type', 'purchase', 'amount', -_price.amount_pence))
  );
end;
$$;

-- The caller's own store-credit balance, in pence (0 with no account yet).
create or replace function public.my_credit_balance()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.ledger_balance(a.id) from public.billing_accounts a where a.owner_id = auth.uid()),
    0
  );
$$;

-- The caller's access: unrefunded purchases that cover them, plus those on
-- their own account. Access only: no amounts, Stripe ids, keys or memos, so a
-- child sees what they can use, not what a parent paid.
create or replace function public.my_entitlements()
returns table (
  purchase_id uuid,
  student_id uuid,
  product_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  purchased_at timestamptz,
  is_current boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.student_id,
    t.product_id,
    t.access_starts_at,
    t.access_ends_at,
    t.created_at,
    (t.access_starts_at <= now() and (t.access_ends_at is null or t.access_ends_at > now()))
  from public.ledger_transactions t
  where t.kind in ('card_purchase', 'credit_purchase')
    and (
      t.student_id = auth.uid()
      or t.account_id in (select a.id from public.billing_accounts a where a.owner_id = auth.uid())
    )
    and not exists (
      select 1 from public.ledger_transactions r where r.reverses_transaction_id = t.id
    )
  order by t.access_starts_at, t.created_at;
$$;

-- --- Service role: money that moved outside the database -------------------

-- A card payment Stripe has taken for a product. Records the money in and the
-- purchase out, so the balance doesn't move. The price may have been switched
-- off since (a renewal on an old price still happened); the amount may be
-- below the list price (a coupon) but never above it.
--
-- A recurring price takes the billing period Stripe charged for (the invoice
-- line's period), and that is the access recorded: Stripe's calendar, not one
-- worked out here, so a renewal never leaves a gap or drifts. It may be up to
-- four days longer than one interval, for subscriptions anchored on the 29th
-- to the 31st. A one-off price takes no period.
--
-- Key it on the Stripe object (invoice or payment intent), not the event. The
-- same payment sent again under another key replays anyway.
create or replace function public.ledger_record_card_purchase(
  p_payer_id uuid,
  p_student_id uuid,
  p_price_id uuid,
  p_amount_pence integer,
  p_external_ref text,
  p_idempotency_key text,
  p_memo text default null,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
)
returns table (transaction_id uuid, balance_pence bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set timezone = 'UTC'
as $$
#variable_conflict use_column
declare
  _key text := private.ledger_service_key(p_idempotency_key);
  _account uuid;
  _fingerprint text := md5(jsonb_build_object(
    'op', 'card_purchase', 'payer', p_payer_id, 'student', p_student_id,
    'price', p_price_id, 'amount', p_amount_pence, 'ref', p_external_ref,
    'from', p_period_start, 'to', p_period_end
  )::text);
  _seen_id uuid;
  _seen_fingerprint text;
  _price record;
  _length interval;
  _starts timestamptz;
  _ends timestamptz;
begin
  _account := private.ledger_lock_account(p_payer_id);

  return query select * from private.ledger_replay(_account, _key, _fingerprint);
  if found then
    return;
  end if;

  if p_external_ref is null then
    raise exception 'A card payment needs its Stripe id.' using errcode = '22023';
  end if;

  -- The same Stripe payment under another key (two events for one invoice,
  -- say): the same request replays, anything else is refused.
  select t.id, t.request_fingerprint into _seen_id, _seen_fingerprint
  from public.ledger_transactions t
  where t.external_ref = p_external_ref;
  if _seen_id is not null then
    if _seen_fingerprint <> _fingerprint then
      raise exception 'This Stripe payment is already recorded, for a different purchase.'
        using errcode = '23505';
    end if;
    return query
    select _seen_id,
           (select e.balance_after_pence from public.ledger_entries e
            where e.transaction_id = _seen_id order by e.seq desc limit 1),
           true;
    return;
  end if;

  perform private.ledger_check_student(p_student_id);

  select pp.id, pp.product_id, pp.amount_pence, pp.billing_interval, pp.access_days
    into _price
  from public.product_prices pp
  where pp.id = p_price_id;
  if not found then
    raise exception 'There is no such price.' using errcode = '22023';
  end if;
  if p_amount_pence is null or p_amount_pence <= 0 or p_amount_pence > _price.amount_pence then
    raise exception 'A card payment is more than nothing and no more than the price (% pence).', _price.amount_pence
      using errcode = '22023';
  end if;

  perform private.ledger_lock_student_product(p_student_id, _price.product_id);

  if _price.billing_interval is null then
    if p_period_start is not null or p_period_end is not null then
      raise exception 'Only a recurring price takes a billing period.' using errcode = '22023';
    end if;
    select w.starts_at, w.ends_at into _starts, _ends
    from private.ledger_access_window(
      p_student_id, _price.product_id, _price.billing_interval, _price.access_days
    ) w;
  else
    _length := private.ledger_period_length(_price.billing_interval, null);
    if p_period_start is null or p_period_end is null
       or p_period_end <= p_period_start
       or p_period_end > p_period_start + _length + interval '4 days'
    then
      raise exception 'A recurring payment needs the billing period Stripe charged for, about one %.', _price.billing_interval
        using errcode = '22023';
    end if;
    _starts := p_period_start;
    _ends := p_period_end;
  end if;

  return query
  select * from private.ledger_write(
    _account, 'card_purchase', _key, _fingerprint,
    p_student_id, _price.product_id, _price.id, p_amount_pence,
    null, p_external_ref, p_memo, _starts, _ends,
    jsonb_build_array(
      jsonb_build_object('type', 'card_payment', 'amount', p_amount_pence),
      jsonb_build_object('type', 'purchase', 'amount', -p_amount_pence)
    )
  );
end;
$$;

-- Store credit given to an account: goodwill, a promotion, a voucher.
create or replace function public.ledger_grant_credit(
  p_owner_id uuid,
  p_amount_pence integer,
  p_idempotency_key text,
  p_memo text default null
)
returns table (transaction_id uuid, balance_pence bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set timezone = 'UTC'
as $$
#variable_conflict use_column
declare
  _key text := private.ledger_service_key(p_idempotency_key);
  _account uuid;
  _fingerprint text := md5(jsonb_build_object(
    'op', 'credit_grant', 'owner', p_owner_id, 'amount', p_amount_pence, 'memo', p_memo
  )::text);
begin
  _account := private.ledger_lock_account(p_owner_id);

  return query select * from private.ledger_replay(_account, _key, _fingerprint);
  if found then
    return;
  end if;

  if p_amount_pence is null or p_amount_pence <= 0 or p_amount_pence > 1000000 then
    raise exception 'Credit is granted in whole pence, between 1p and £10,000.' using errcode = '22023';
  end if;

  return query
  select * from private.ledger_write(
    _account, 'credit_grant', _key, _fingerprint,
    null, null, null, p_amount_pence,
    null, null, p_memo, null, null,
    jsonb_build_array(jsonb_build_object('type', 'credit_grant', 'amount', p_amount_pence))
  );
end;
$$;

-- Refunds one purchase in full, once. To credit: the account gets the amount
-- back as store credit. To card: the credit goes straight back out to the card
-- (Stripe has refunded it; p_external_ref is the re_… id), so the balance
-- doesn't move. A purchase paid with credit is refunded to credit only.
-- The refund ends that purchase's access; later purchases keep their own dates.
create or replace function public.ledger_refund(
  p_transaction_id uuid,
  p_destination text,
  p_idempotency_key text,
  p_external_ref text default null,
  p_memo text default null
)
returns table (transaction_id uuid, balance_pence bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set timezone = 'UTC'
as $$
#variable_conflict use_column
declare
  _key text := private.ledger_service_key(p_idempotency_key);
  _orig record;
  _closed timestamptz;
  _fingerprint text := md5(jsonb_build_object(
    'op', 'refund', 'of', p_transaction_id, 'to', p_destination, 'ref', p_external_ref, 'memo', p_memo
  )::text);
  _entries jsonb;
begin
  select t.id, t.account_id, t.kind, t.student_id, t.product_id, t.price_id, t.amount_pence
    into _orig
  from public.ledger_transactions t
  where t.id = p_transaction_id;
  if not found or _orig.kind not in ('card_purchase', 'credit_purchase') then
    raise exception 'Only a purchase can be refunded.' using errcode = '22023';
  end if;

  select a.closed_at into _closed
  from public.billing_accounts a
  where a.id = _orig.account_id
  for update;

  return query select * from private.ledger_replay(_orig.account_id, _key, _fingerprint);
  if found then
    return;
  end if;

  perform private.ledger_lock_student_product(_orig.student_id, _orig.product_id);

  if exists (select 1 from public.ledger_transactions r where r.reverses_transaction_id = _orig.id) then
    raise exception 'That purchase has already been refunded.' using errcode = '23505';
  end if;

  if p_destination = 'credit' then
    if _closed is not null then
      raise exception 'This account is closed, so the refund has to go back to the card.'
        using errcode = '22023';
    end if;
    _entries := jsonb_build_array(
      jsonb_build_object('type', 'refund', 'amount', _orig.amount_pence)
    );
  elsif p_destination = 'card' then
    if _orig.kind <> 'card_purchase' then
      raise exception 'A purchase paid with credit is refunded as credit.' using errcode = '22023';
    end if;
    if p_external_ref is null then
      raise exception 'A refund to card needs its Stripe refund id.' using errcode = '22023';
    end if;
    _entries := jsonb_build_array(
      jsonb_build_object('type', 'refund', 'amount', _orig.amount_pence),
      jsonb_build_object('type', 'card_refund', 'amount', -_orig.amount_pence)
    );
  else
    raise exception 'A refund goes to ''credit'' or ''card''.' using errcode = '22023';
  end if;

  return query
  select * from private.ledger_write(
    _orig.account_id, 'refund', _key, _fingerprint,
    _orig.student_id, _orig.product_id, _orig.price_id, _orig.amount_pence,
    _orig.id, p_external_ref, p_memo, null, null,
    _entries
  );
end;
$$;

-- A signed correction to an account's credit, with the reason in the memo.
-- The balance still can't go below zero.
create or replace function public.ledger_adjust(
  p_owner_id uuid,
  p_amount_pence integer,
  p_memo text,
  p_idempotency_key text
)
returns table (transaction_id uuid, balance_pence bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
set timezone = 'UTC'
as $$
#variable_conflict use_column
declare
  _key text := private.ledger_service_key(p_idempotency_key);
  _account uuid;
  _fingerprint text := md5(jsonb_build_object(
    'op', 'adjustment', 'owner', p_owner_id, 'amount', p_amount_pence, 'memo', p_memo
  )::text);
begin
  _account := private.ledger_lock_account(p_owner_id);

  return query select * from private.ledger_replay(_account, _key, _fingerprint);
  if found then
    return;
  end if;

  if p_amount_pence is null or p_amount_pence = 0 or abs(p_amount_pence) > 1000000 then
    raise exception 'An adjustment is a non-zero number of pence, up to £10,000 either way.'
      using errcode = '22023';
  end if;
  if p_memo is null or length(btrim(p_memo)) = 0 then
    raise exception 'An adjustment needs its reason in the memo.' using errcode = '22023';
  end if;

  return query
  select * from private.ledger_write(
    _account, 'adjustment', _key, _fingerprint,
    null, null, null, abs(p_amount_pence),
    null, null, p_memo, null, null,
    jsonb_build_array(jsonb_build_object('type', 'adjustment', 'amount', p_amount_pence))
  );
end;
$$;

revoke all on function
  public.ledger_purchase_with_credit(uuid, uuid, text),
  public.my_credit_balance(),
  public.my_entitlements(),
  public.ledger_record_card_purchase(uuid, uuid, uuid, integer, text, text, text, timestamptz, timestamptz),
  public.ledger_grant_credit(uuid, integer, text, text),
  public.ledger_refund(uuid, text, text, text, text),
  public.ledger_adjust(uuid, integer, text, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.ledger_purchase_with_credit(uuid, uuid, text),
  public.my_credit_balance(),
  public.my_entitlements()
to authenticated;

grant execute on function
  public.ledger_record_card_purchase(uuid, uuid, uuid, integer, text, text, text, timestamptz, timestamptz),
  public.ledger_grant_credit(uuid, integer, text, text),
  public.ledger_refund(uuid, text, text, text, text),
  public.ledger_adjust(uuid, integer, text, text)
to service_role;
