-- Move the Edexcel International curriculum onto the igcse level added in the
-- previous migration. Scoped to board = edexcel_intl so ordinary GCSE content
-- is untouched.
--
-- spec_points carry no level of their own — they hang off topics — so they
-- follow automatically. student_term_plans, student_weekly_plans, weekly_focus
-- and student_enrolments held no edexcel_intl rows when this ran, and profiles
-- are deliberately left alone: profiles.level has no board to scope by, and no
-- student was enrolled on this board yet.
update public.topics    set level = 'igcse' where board = 'edexcel_intl' and level = 'gcse';
update public.resources set level = 'igcse' where board = 'edexcel_intl' and level = 'gcse';
