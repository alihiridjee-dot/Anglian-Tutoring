-- The previous migration revoked EXECUTE from authenticated, which broke every
-- gated policy: an RLS qual is evaluated as the CALLING role, so `authenticated`
-- must be able to execute the function even though it is SECURITY DEFINER.
-- Symptom was 42501 "permission denied for function viewer_has_content_access"
-- on topics/spec_points/resources/mcq_*/weekly_focus for ALL students,
-- including paying ones.
--
-- Granting EXECUTE means a user could call it directly with an arbitrary uuid
-- and learn whether that person's subscription is live, so the body now
-- refuses to answer for anyone but the caller (unless the caller is a tutor) —
-- the same defensive shape private.has_role() already uses.
create or replace function private.viewer_has_content_access(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  select case
    when p_uid is null then false
    -- only answer about yourself, unless you are a tutor
    when p_uid <> (select auth.uid())
         and not private.has_role((select auth.uid()), 'tutor'::app_role)
      then false
    when private.has_role(p_uid, 'tutor'::app_role) then true
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'student')
      then private.student_has_access(p_uid)
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'parent')
      then exists (
        select 1 from public.parent_student_links l
        where l.parent_id = p_uid
          and private.student_has_access(l.student_id)
      )
    else false
  end
$function$;

grant execute on function private.viewer_has_content_access(uuid) to authenticated;
revoke execute on function private.viewer_has_content_access(uuid) from anon, public;
