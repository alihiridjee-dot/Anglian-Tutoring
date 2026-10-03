-- Hand-run rollback for 20261003122518_user_roles_no_client_writes.sql: the
-- grants as they were live on 3 Oct 2026.
grant insert, update, delete, truncate on public.user_roles to anon, authenticated;
