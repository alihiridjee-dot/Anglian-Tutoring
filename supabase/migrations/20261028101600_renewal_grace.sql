-- A paying student keeps access through the moment their plan renews.
--
-- A plan's period end only moves forward when Stripe's renewal webhook lands.
-- Until then the row still says 'active' with an end in the past, and every
-- access check read that as lapsed: the paywall told a paying student to
-- resubscribe, and Checkout refused them because the plan is still live. A
-- webhook is normally seconds late, but Stripe retries a failed one for hours.
--
-- So an 'active' or 'trialing' plan now counts for one day past its period
-- end. A plan that is cancelled, unpaid or paused still loses access the
-- moment the webhook says so; this only bridges a late renewal.
--
-- Bodies copied from the live definitions on 28 Oct (md5 of prosrc:
-- student_has_access 124915a9cf0d0b9302ade8624c41d90a, my_paid_subject_cap
-- 247e5d3fa0b0ee8ff03e972fad92b8cb, student_paid_subjects
-- d2a8b0570fe23c9f94ccdd4c2e3ac29d). The only change in each is
-- `> now()` becoming `> now() - interval '1 day'`. create or replace keeps
-- their owners and grants.

CREATE OR REPLACE FUNCTION private.student_has_access(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select exists (
    select 1 from public.subscriptions s
    where s.student_id = p_student_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now() - interval '1 day')
  );
$function$;

CREATE OR REPLACE FUNCTION private.my_paid_subject_cap()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select max(
    case
      when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int
      else null
    end
  )
  from public.subscriptions s
  where s.student_id = (select auth.uid())
    and s.status in ('active', 'trialing')
    and (s.current_period_end is null or s.current_period_end > now() - interval '1 day');
$function$;

CREATE OR REPLACE FUNCTION private.student_paid_subjects(p_student_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  select coalesce(
    (
      select case
        when x.cap is null then x.courses
        else x.courses[1:x.cap]
      end
      from (
        select
          coalesce(p.enrolled_courses, '{}'::text[]) as courses,
          (
            select max(
              case
                when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int
                else null
              end
            )
            from public.subscriptions s
            where s.student_id = p_student_id
              and s.status in ('active', 'trialing')
              and (s.current_period_end is null or s.current_period_end > now() - interval '1 day')
          ) as cap
        from public.profiles p
        where p.id = p_student_id
          and private.student_has_access(p_student_id)
      ) x
    ),
    '{}'::text[]
  )
$function$;
