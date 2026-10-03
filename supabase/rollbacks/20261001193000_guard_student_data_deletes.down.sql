-- Rollback for 20261001193000_guard_student_data_deletes.sql. Reopens S-18:
-- deleting a topic or quiz set deletes students' attempts and planner history
-- again. Roll the app back first: "Replace questions" calls the function.
drop trigger if exists t_topics_keep_student_data on public.topics;
drop trigger if exists t_spec_points_keep_student_data on public.spec_points;
drop trigger if exists t_mcq_sets_keep_student_data on public.mcq_sets;
drop function if exists private.refuse_deleting_student_data();
drop function if exists private.student_data_on_points(uuid[], uuid);
drop function if exists public.replace_generated_mcq_questions(uuid, jsonb);
