-- International GCSE is a LEVEL (level='igcse'), offered by every board — it was
-- wrongly modelled as a board ('edexcel_intl'). The existing international content
-- is Edexcel International GCSE, so it moves to board='edexcel' and keeps
-- level='igcse'. Level is what keeps iGCSE content separate from regular GCSE:
-- topics/resources/plans are all keyed by (level, board, subject), so an iGCSE
-- student never sees GCSE spec points and vice versa.

update topics               set board = 'edexcel' where board = 'edexcel_intl';
update resources            set board = 'edexcel' where board = 'edexcel_intl';
update student_enrolments   set board = 'edexcel' where board = 'edexcel_intl';
update student_term_plans   set board = 'edexcel' where board = 'edexcel_intl';
update student_weekly_plans set board = 'edexcel' where board = 'edexcel_intl';
update weekly_focus         set board = 'edexcel' where board = 'edexcel_intl';

-- The enum value has to go, and Postgres cannot drop one in place: recreate the
-- type. curriculum_coverage() returns it, so it is dropped and rebuilt around it.
drop function if exists public.curriculum_coverage();

alter type board rename to board_old;
create type board as enum ('edexcel', 'aqa', 'ocr');

alter table resources            alter column board type board using board::text::board;
alter table student_enrolments   alter column board type board using board::text::board;
alter table student_term_plans   alter column board type board using board::text::board;
alter table student_weekly_plans alter column board type board using board::text::board;
alter table topics               alter column board type board using board::text::board;
alter table weekly_focus         alter column board type board using board::text::board;

drop type board_old;

create or replace function public.curriculum_coverage()
returns table(level level, board board, subject subject, topic_count bigint, spec_point_count bigint)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    t.level,
    t.board,
    t.subject,
    count(distinct t.id) as topic_count,
    count(sp.id)         as spec_point_count
  from public.topics t
  left join public.spec_points sp on sp.topic_id = t.id
  group by t.level, t.board, t.subject
$function$;

grant execute on function public.curriculum_coverage() to anon, authenticated, service_role;
