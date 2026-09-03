-- Stop a student enrolling in more subjects than their plan pays for.
--
-- The price ladder is cadence × subject-COUNT: `weekly_1` buys one subject,
-- `weekly_3` buys three, and `packages.subjects` is empty for these tiers
-- because the parent picks *which* subjects on the landing page — only the count
-- is priced. The content RLS then scopes every read to the subjects in
-- `profiles.enrolled_courses` (via `private.my_content_subjects()`).
--
-- The gap this closes: `save_student_enrolments` is the one writer of that list
-- and it accepted up to twenty subjects regardless of the plan. So a student on
-- an active `weekly_1` could call it with all three subjects and read the whole
-- curriculum — biology, chemistry and physics — for the price of one. Verified
-- end to end against production before this migration: 1 subject paid, 123
-- topics across 3 subjects readable.
--
-- The sanctioned way to grow a plan is the billing page's "add subjects", which
-- ladders the Stripe price up and charges the difference (stripe-checkout
-- `add_subjects`). Nothing stopped a student side-stepping that by calling this
-- RPC directly, which is the door being shut here.
--
-- The cap only ever bites a student who has a LIVE subscription whose tier
-- encodes a numeric count. It is deliberately silent when:
--   • there is no active/trialing subscription — onboarding picks subjects
--     before paying, and a lapsed student keeps their history; content access is
--     independently gated by `viewer_has_content_access`, so an uncapped
--     no-subscription student still sees no paid content, and
--   • the tier is a legacy flat plan (`weekly`/`monthly`/`tri_monthly`) with no
--     `_N` suffix — those are grandfathered and must keep resolving.
-- That is the safe direction to fail: this never blocks onboarding and never
-- accuses a paying student, it only refuses to widen access past what was paid.
--
-- NOTE: this guards the write path. The initial-checkout counterpart — where
-- `stripe-checkout`'s `handleCheckout` trusts a client-supplied `tier` instead
-- of deriving the count from enrolments — is fixed alongside this in the edge
-- function, so a student cannot declare three subjects and then buy the
-- one-subject tier. Both are needed to fully close the entitlement gap.

-- The subject count the caller's live plan grants, or NULL for "no cap".
create or replace function private.my_paid_subject_cap()
returns int
language sql
stable
security definer
set search_path to 'public', 'private'
as $$
  select max(
    case
      when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int
      else null
    end
  )
  from public.subscriptions s
  where s.student_id = (select auth.uid())
    and s.status in ('active', 'trialing')
    and (s.current_period_end is null or s.current_period_end > now());
$$;

revoke all on function private.my_paid_subject_cap() from public, anon;
grant execute on function private.my_paid_subject_cap() to authenticated;

-- Re-declare the writer with the cap. Body is unchanged from
-- 20260806232142 apart from the cap block; SECURITY DEFINER and the `= _uid`
-- scoping on every statement are preserved.
create or replace function public.save_student_enrolments(_subjects jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid();
  _keep text[];
  _cap int;
begin
  if _uid is null then
    raise exception 'not signed in';
  end if;
  if jsonb_typeof(coalesce(_subjects, '[]'::jsonb)) <> 'array' then
    raise exception 'subjects must be an array';
  end if;
  if jsonb_array_length(coalesce(_subjects, '[]'::jsonb)) > 20 then
    raise exception 'too many subjects';
  end if;

  select coalesce(array_agg(distinct e->>'subject'), '{}'::text[])
  into _keep
  from jsonb_array_elements(coalesce(_subjects, '[]'::jsonb)) e;

  -- A live plan caps how many subjects may be enrolled. Growing past it goes
  -- through the billing page (which charges the upgrade), never through here.
  _cap := private.my_paid_subject_cap();
  if _cap is not null and cardinality(_keep) > _cap then
    raise exception
      'Your plan covers % subject(s). Add subjects from the billing page to upgrade your plan.', _cap
      using errcode = 'check_violation';
  end if;

  -- Drop de-selected subjects: narrowing from three to one must actually
  -- remove access to the other two, which an upsert alone would not do.
  --
  -- SECURITY DEFINER bypasses RLS, so the `= _uid` on every statement below is
  -- now the only thing holding this to the caller's own rows. _uid comes from
  -- auth.uid(), never from an argument, so there is nothing to pass in.
  delete from student_enrolments
  where student_id = _uid
    and (_keep = '{}'::text[] or subject::text <> all (_keep));

  insert into student_enrolments (student_id, subject, board)
  select _uid, (e->>'subject')::subject, (e->>'board')::board
  from jsonb_array_elements(coalesce(_subjects, '[]'::jsonb)) e
  on conflict (student_id, subject) do update set board = excluded.board;

  -- The denormalised list many reads (and the content RLS) still use. Moving in
  -- the same transaction as the rows above is the whole point of this function.
  update profiles set enrolled_courses = _keep where id = _uid;
end
$function$;

revoke all on function public.save_student_enrolments(jsonb) from public, anon;
grant execute on function public.save_student_enrolments(jsonb) to authenticated;
