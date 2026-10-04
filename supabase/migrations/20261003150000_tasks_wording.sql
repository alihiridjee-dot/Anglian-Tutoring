-- Students and tutors now see "tasks" where the site said "homework" (the
-- page is Tasks & Grades). The words people read that the database writes are
-- renamed to match: the bell notification when a task is marked, the tutor's
-- acknowledgement notification's fallback title, and the error messages that
-- reach a toast. Only those quoted strings change. Each function below is its
-- live definition (pg_get_functiondef, 3 Oct 2026) otherwise untouched; the
-- 'homework' kind and enum values, the homework_marked type and the /homework
-- links stay as they are, because those are names, not words on a screen.
--
-- Notifications already sent keep the wording they were sent with.

CREATE OR REPLACE FUNCTION public.acknowledge_submission(_submission_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s            record;
  student_name text;
  hw_title     text;
begin
  select * into s from public.homework_submissions where id = _submission_id;
  if not found then
    raise exception 'Submission not found';
  end if;
  if s.student_id <> auth.uid() then
    raise exception 'You can only acknowledge your own submission';
  end if;
  if s.graded_at is null then
    raise exception 'This submission has not been marked yet';
  end if;
  if s.acknowledged_at is not null then
    return; -- already acknowledged; stay idempotent
  end if;

  update public.homework_submissions
     set acknowledged_at = now()
   where id = _submission_id;

  select display_name into student_name from public.profiles where id = s.student_id;
  select title        into hw_title     from public.resources where id = s.resource_id;

  if s.graded_by is not null then
    insert into public.notifications (user_id, type, title, body, link, submission_id)
    values (
      s.graded_by,
      'feedback_acknowledged',
      coalesce(nullif(student_name, ''), 'A student') || ' acknowledged your feedback',
      coalesce(hw_title, 'Task'),
      '/homework',
      _submission_id
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_submission_size_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  size_bytes bigint;
begin
  if new.bucket_id = 'resources' and new.name like 'submissions/%' then
    size_bytes := coalesce((new.metadata->>'size')::bigint, 0);
    if size_bytes > 1048576 then
      raise exception 'Task uploads are limited to 1 MB (received % KB)',
        round(size_bytes / 1024.0);
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_generated_homework(_spec_point_id uuid, _title text, _subject subject, _level level, _questions jsonb, _created_by uuid DEFAULT NULL::uuid, _board board DEFAULT NULL::board, _publish_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _resource_id uuid;
begin
  -- `_created_by` is accepted and ignored: a library sheet belongs to nobody.

  -- Already generated, possibly by another student moments ago.
  select r.id into _resource_id
  from public.resources r
  where r.kind = 'homework' and r.spec_point_id = _spec_point_id;
  if _resource_id is not null then
    return _resource_id;
  end if;

  if not exists (select 1 from public.spec_points sp where sp.id = _spec_point_id) then
    raise exception 'Unknown spec point';
  end if;

  if _questions is null or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to create a task with no questions';
  end if;

  insert into public.resources
    (kind, title, subject, board, level, spec_point_id, created_by, origin,
     review_status, publish_at)
  values
    ('homework', _title, _subject, _board, _level, _spec_point_id, null, 'generated',
     'to_review', coalesce(_publish_at, now()))
  on conflict (spec_point_id) where kind = 'homework' and spec_point_id is not null
  do nothing
  returning id into _resource_id;

  -- Lost the race: the winner's sheet is the one everybody uses.
  if _resource_id is null then
    select r.id into _resource_id
    from public.resources r
    where r.kind = 'homework' and r.spec_point_id = _spec_point_id;
    return _resource_id;
  end if;

  insert into public.homework_questions
    (resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id)
  select
    _resource_id,
    (t.ord - 1)::int,
    t.q ->> 'prompt',
    greatest(1, least(30, coalesce((t.q ->> 'marks')::int, 2))),
    case when t.q ->> 'answer_type' in ('short', 'long', 'numeric')
         then t.q ->> 'answer_type' else 'short' end,
    nullif(btrim(coalesce(t.q ->> 'mark_scheme', '')), ''),
    _spec_point_id
  from jsonb_array_elements(_questions) with ordinality as t(q, ord)
  where nullif(btrim(coalesce(t.q ->> 'prompt', '')), '') is not null;

  insert into public.resource_spec_points (resource_id, spec_point_id)
  values (_resource_id, _spec_point_id)
  on conflict do nothing;

  return _resource_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_homework_marks(_submission_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _sub public.homework_submissions;
  _staged public.homework_ai_marks;
  _awarded numeric;
  _total numeric;
  _pct numeric;
  _title text;
begin
  if auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role'
     and not private.has_role(auth.uid(), 'tutor'::public.app_role)
     and not private.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only tutors or admins may publish marks'
      using errcode = '42501';
  end if;

  select * into _sub
    from public.homework_submissions
   where id = _submission_id
     for update;

  if not found then
    raise exception 'No such submission';
  end if;

  if _sub.graded_at is not null then
    return false;
  end if;

  select * into _staged
    from public.homework_ai_marks
   where submission_id = _submission_id;

  if not found then
    return false;
  end if;

  perform set_config('app.publishing_marks', 'on', true);

  update public.homework_answers a
     set awarded_marks = least(greatest(coalesce((m ->> 'marks')::numeric, 0), 0), q.marks),
         feedback = nullif(btrim(coalesce(m ->> 'feedback', '')), '')
    from jsonb_array_elements(coalesce(_staged.marks, '[]'::jsonb)) m
    join public.homework_questions q
      on q.id = (m ->> 'question_id')::uuid
   where a.submission_id = _submission_id
     and a.question_id = q.id;

  select coalesce(sum(a.awarded_marks), 0), coalesce(sum(q.marks), 0)
    into _awarded, _total
    from public.homework_questions q
    left join public.homework_answers a
      on a.question_id = q.id and a.submission_id = _submission_id
   where q.resource_id = _sub.resource_id
     and (a.id is not null or q.created_at <= _sub.submitted_at);

  _pct := case when _total > 0 then round((_awarded / _total) * 100) else null end;

  update public.homework_submissions
     set score_pct = _pct,
         grade = case
           when _pct is null then null
           when _pct >= 90 then '9' when _pct >= 80 then '8'
           when _pct >= 70 then '7' when _pct >= 60 then '6'
           when _pct >= 50 then '5' when _pct >= 40 then '4'
           when _pct >= 30 then '3' when _pct >= 20 then '2'
           else '1' end,
         feedback = coalesce(feedback, nullif(btrim(coalesce(_staged.summary, '')), '')),
         graded_at = now()
   where id = _submission_id;

  select r.title into _title
    from public.resources r
   where r.id = _sub.resource_id;

  insert into public.notifications (user_id, type, title, body, link, submission_id)
  values (
    _sub.student_id,
    'homework_marked',
    'Your task has been marked',
    coalesce(_title, 'Task') ||
      case when _pct is not null then ' — ' || _pct::text || '%' else '' end,
    '/homework/' || _sub.resource_id::text,
    _submission_id
  );

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_homework_brief(_id uuid, _title text, _instructions text, _due_at timestamp with time zone, _subject subject, _board board, _level level, _spec_point_ids uuid[], _questions jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  _rid uuid;
  _kept uuid[];
  _q jsonb;
  _pos int;
  _qid uuid;
begin
  _questions := coalesce(_questions, '[]'::jsonb);
  if jsonb_typeof(_questions) <> 'array' then
    raise exception 'Questions must be a list';
  end if;

  _kept := array(
    select (e->>'id')::uuid
    from jsonb_array_elements(_questions) e
    where nullif(e->>'id', '') is not null
  );
  if cardinality(_kept) <> (select count(distinct k) from unnest(_kept) k) then
    raise exception 'A question appears twice';
  end if;

  if _id is null then
    insert into public.resources(
      kind, title, instructions, due_at, subject, board, level, created_by, origin
    )
    values (
      'homework'::public.resource_kind, _title, _instructions, _due_at,
      _subject, _board, _level, (select auth.uid()),
      -- A brief written here is one somebody decided to set, which is what
      -- separates it from the generated library in the student's list.
      'tutor'::public.resource_origin
    )
    returning id into _rid;
  else
    -- Also locks the brief, so two saves of it run one after the other.
    update public.resources
       set title = _title,
           instructions = _instructions,
           due_at = _due_at,
           subject = _subject,
           board = _board,
           level = _level
     where id = _id
       and kind = 'homework'::public.resource_kind
    returning id into _rid;
    if _rid is null then
      raise exception 'This task no longer exists.' using errcode = 'P0002';
    end if;
  end if;

  delete from public.homework_questions
   where resource_id = _rid
     and id <> all(_kept);

  update public.homework_questions
     set position = -1 - position
   where resource_id = _rid;

  for _q, _pos in
    select e.value, (e.ordinality - 1)::int
    from jsonb_array_elements(_questions) with ordinality as e(value, ordinality)
  loop
    if coalesce(btrim(_q->>'prompt'), '') = '' then
      raise exception 'Every question needs a prompt.';
    end if;
    _qid := nullif(_q->>'id', '')::uuid;

    if _qid is null then
      insert into public.homework_questions(
        resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id
      )
      values (
        _rid, _pos, btrim(_q->>'prompt'), (_q->>'marks')::int,
        coalesce(_q->>'answer_type', 'short'),
        nullif(btrim(_q->>'mark_scheme'), ''),
        nullif(_q->>'spec_point_id', '')::uuid
      );
    else
      update public.homework_questions
         set position = _pos,
             prompt = btrim(_q->>'prompt'),
             marks = (_q->>'marks')::int,
             answer_type = coalesce(_q->>'answer_type', 'short'),
             mark_scheme = nullif(btrim(_q->>'mark_scheme'), ''),
             spec_point_id = nullif(_q->>'spec_point_id', '')::uuid
       where id = _qid
         and resource_id = _rid;
      if not found then
        raise exception 'A question on this task was removed while you were editing it. Close it and open it again.'
          using errcode = 'P0002';
      end if;
    end if;
  end loop;

  -- Curriculum links: links that stay keep their row.
  delete from public.resource_spec_points
   where resource_id = _rid
     and spec_point_id <> all(coalesce(_spec_point_ids, '{}'::uuid[]));
  insert into public.resource_spec_points(resource_id, spec_point_id)
  select distinct _rid, p
  from unnest(coalesce(_spec_point_ids, '{}'::uuid[])) as p
  on conflict do nothing;

  return _rid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_homework_answers(_resource_id uuid, _answers jsonb, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _uid uuid := auth.uid();
  _submission_id uuid;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1 from public.resources r where r.id = _resource_id and r.kind = 'homework'
  ) then
    raise exception 'That task does not exist';
  end if;

  -- The resources policy's rule, for the caller (see the header).
  if not exists (
    select 1 from public.resources r
    where r.id = _resource_id
      and (
        private.has_role(_uid, 'tutor'::public.app_role)
        or (
          r.subject::text = any (private.student_paid_subjects(_uid))
          and (
            r.review_status = 'approved'
            or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now()))
          )
        )
      )
  ) then
    raise exception 'That task is not open to you';
  end if;

  if exists (
    select 1 from public.homework_submissions s
    where s.resource_id = _resource_id and s.student_id = _uid
  ) then
    raise exception 'You have already submitted this task';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a
    where not exists (
      select 1 from public.homework_questions q
      where q.id = (a ->> 'question_id')::uuid and q.resource_id = _resource_id
    )
  ) then
    raise exception 'An answer refers to a question that is not on this task';
  end if;

  insert into public.homework_submissions (resource_id, student_id, notes, submitted_at)
  values (_resource_id, _uid, nullif(btrim(coalesce(_notes, '')), ''), now())
  returning id into _submission_id;

  insert into public.homework_answers (submission_id, question_id, answer_text)
  select
    _submission_id,
    (a ->> 'question_id')::uuid,
    nullif(btrim(coalesce(a ->> 'answer_text', '')), '')
  from jsonb_array_elements(coalesce(_answers, '[]'::jsonb)) a;

  delete from public.homework_drafts
   where student_id = _uid and resource_id = _resource_id;

  return _submission_id;
end;
$function$;
