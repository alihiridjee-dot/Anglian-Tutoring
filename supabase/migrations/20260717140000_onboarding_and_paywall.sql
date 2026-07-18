-- Onboarding + paywall
--
-- Two structural changes underpin everything here:
--
-- 1. A subscription now names the student it COVERS (student_id) separately
--    from the account that PAYS for it (user_id). A student may pay for
--    themselves (the two are equal) or a linked parent may pay on their behalf
--    (they differ). Access is asked as "does this student have a live
--    subscription", never "is this user a payer".
--
-- 2. Enrolment is no longer granted at sign-up. handle_new_user used to insert
--    student_enrolments and a `trialing` subscription straight from sign-up
--    metadata, which handed out access before anyone paid. Onboarding owns
--    both now, and status starts at 'inactive'.

-- --- Who a subscription covers ---------------------------------------------

-- Rows left behind by deleted accounts and by the removed demo seed. They point
-- at users present in neither profiles nor auth.users, so nothing can read them
-- and they grant nobody access — but student_id cannot become a NOT NULL
-- foreign key while they exist.
delete from public.subscriptions s
where not exists (select 1 from public.profiles p where p.id = s.user_id);

alter table public.subscriptions
  add column if not exists student_id uuid references public.profiles (id) on delete cascade;

-- Every existing row was a student paying for themselves.
update public.subscriptions set student_id = user_id where student_id is null;

alter table public.subscriptions alter column student_id set not null;

-- One live subscription per student, regardless of who pays for it. The old
-- unique(user_id) would have stopped a parent funding a second child.
alter table public.subscriptions drop constraint if exists subscriptions_user_id_key;
create unique index if not exists subscriptions_student_id_key on public.subscriptions (student_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);

-- A parent paying for a child must be able to see the row they are paying for,
-- and a student must see a subscription a parent bought for them. Replaces the
-- old self-or-tutor policy, which addressed user_id only.
drop policy if exists "subs read self or tutor" on public.subscriptions;
create policy "subs read payer student or tutor" on public.subscriptions
  for select to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = student_id
    or exists (
      select 1 from public.parent_student_links l
      where l.parent_id = auth.uid() and l.student_id = subscriptions.student_id
    )
    or private.has_role(auth.uid(), 'tutor'::public.app_role)
  );

-- Deliberately no INSERT/UPDATE policy: the Stripe webhook (service role) is
-- the only writer. A client that could write this table could grant itself
-- access for free.

-- --- Stripe customers ------------------------------------------------------

-- The Stripe customer belongs to the payer, not to any one subscription: a
-- parent funding two children is one customer with two subscriptions.
create table if not exists public.stripe_customers (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

alter table public.stripe_customers enable row level security;

create policy "stripe customers read self" on public.stripe_customers
  for select to authenticated using (auth.uid() = user_id);

-- Backfill from the customer ids the subscriptions table already carries.
insert into public.stripe_customers (user_id, stripe_customer_id)
select distinct on (user_id) user_id, stripe_customer_id
from public.subscriptions
where stripe_customer_id is not null
on conflict (user_id) do nothing;

-- --- Onboarding: what the student tells us ---------------------------------

-- Grades are per-subject, and student_enrolments is already the per-subject
-- table (it carries the exam board), so they belong here rather than in a
-- parallel table keyed the same way. All three are optional by design.
alter table public.student_enrolments
  add column if not exists previous_grade text,
  add column if not exists current_grade text,
  add column if not exists target_grade text;

-- School is per-student. onboarding_completed_at is the gate the guard reads:
-- null means "has not finished profile setup", and it is set only once board
-- and subjects (the load-bearing answers) exist.
alter table public.profiles
  add column if not exists school text,
  add column if not exists onboarding_completed_at timestamptz;

-- Slider answers. Stored as jsonb because the question set is pedagogy, not
-- schema — it will be reworded and extended without a migration each time.
create table if not exists public.student_learning_profile (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  responses jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.student_learning_profile enable row level security;

create policy "slp self read" on public.student_learning_profile
  for select to authenticated using (auth.uid() = student_id);
create policy "slp self write" on public.student_learning_profile
  for insert to authenticated with check (auth.uid() = student_id);
create policy "slp self update" on public.student_learning_profile
  for update to authenticated using (auth.uid() = student_id);
create policy "slp parent reads linked" on public.student_learning_profile
  for select to authenticated
  using (
    exists (
      select 1 from public.parent_student_links l
      where l.parent_id = auth.uid() and l.student_id = student_learning_profile.student_id
    )
  );
create policy "slp tutor read" on public.student_learning_profile
  for select to authenticated
  using (private.has_role(auth.uid(), 'tutor'::public.app_role));

-- --- Plans -----------------------------------------------------------------

-- packages gains the Stripe price it maps to, and its billing period. The
-- price itself stays in Stripe; price_pence is for display only.
alter table public.packages
  add column if not exists stripe_price_id text,
  add column if not exists billing_interval text;

-- --- The access question ---------------------------------------------------

-- One helper, asked of the student — never of the payer. Both the route guard
-- and (later) RLS policies call this, so the paywall has a single definition.
create or replace function private.student_has_access(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.student_id = p_student_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

grant execute on function private.student_has_access(uuid) to authenticated;

-- Callable from the client for the student's own gate. Kept separate from the
-- private.* helper so RLS policies and the app don't share an attack surface.
create or replace function public.my_access_state()
returns table (has_access boolean, onboarding_complete boolean)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    private.student_has_access(auth.uid()),
    (select p.onboarding_completed_at is not null from public.profiles p where p.id = auth.uid());
$$;

grant execute on function public.my_access_state() to authenticated;

-- --- Sign-up no longer grants anything -------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text;
  final_role public.profile_role;
begin
  meta_role := lower(coalesce(NEW.raw_user_meta_data->>'role', 'student'));
  final_role := case
    when meta_role in ('student', 'parent', 'tutor') then meta_role::public.profile_role
    else 'student'::public.profile_role
  end;

  insert into public.profiles (id, display_name, role, phone)
  values (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    final_role,
    NEW.raw_user_meta_data->>'phone'
  );

  if lower(NEW.email) = 'asa180@live.co.uk' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor');
    update public.profiles set role = 'tutor' where id = NEW.id;
  elsif final_role = 'tutor' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor');
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'student');
  end if;

  -- Level, board, subjects and the subscription are all captured in
  -- /onboarding now. Enrolling here would grant curriculum access to an
  -- unpaid account, which is the whole thing the paywall exists to prevent.

  if final_role = 'parent' and NEW.raw_user_meta_data->>'parent_invite_code' is not null then
    insert into public.parent_student_links (parent_id, student_id)
    select NEW.id, p.id from public.profiles p
    where p.student_invite_code = upper(NEW.raw_user_meta_data->>'parent_invite_code');
  end if;

  return NEW;
end;
$$;

-- --- Grandfather everyone who signed up under the old flow ------------------

-- Students already using the app keep access and skip setup. Their real Stripe
-- subscription gets attached by hand later; until then plan='grandfathered'
-- marks them so they are easy to find and are never mistaken for a Stripe row.
update public.profiles
set onboarding_completed_at = now()
where role = 'student' and onboarding_completed_at is null;

update public.subscriptions
set status = 'active', updated_at = now()
where status = 'trialing';

insert into public.subscriptions (user_id, student_id, status, plan)
select p.id, p.id, 'active', 'grandfathered'
from public.profiles p
where p.role = 'student'
  and not exists (select 1 from public.subscriptions s where s.student_id = p.id)
on conflict do nothing;
