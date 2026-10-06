-- Hand-run rollback for 20261001180100_leads_server_only.sql: the grants and
-- the insert policy as they were live on 1 Oct 2026.
grant all on public.leads to anon;
grant insert, delete, truncate on public.leads to authenticated;

drop policy if exists "leads public insert" on public.leads;
create policy "leads public insert" on public.leads
  for insert to anon, authenticated
  with check (
    char_length(email) >= 3 and char_length(email) <= 320
    and char_length(name) >= 1 and char_length(name) <= 200
    and char_length(message) >= 1 and char_length(message) <= 4000
    and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  );
