-- Rollback for 20261117120000_parent_join_links: "My parent is paying" links
-- stop working. Parents already linked through one stay linked: the links live
-- in parent_student_links, which this never touches.
drop function if exists public.parent_join_link_status(text);
drop function if exists public.redeem_parent_join_link(text);
drop function if exists public.peek_parent_join_link(text);
drop function if exists public.create_parent_join_link(text);
drop function if exists private.parent_join_token_hash(text);
drop function if exists private.parent_join_plan(uuid, text);
drop table if exists public.parent_join_links;
