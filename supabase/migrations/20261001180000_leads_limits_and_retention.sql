-- S-38, step 1 of 2 · Field limits as constraints, and leads kept 12 months.
-- Safe to apply before or after the app change.
--
-- Field limits lived only in the "leads public insert" policy, which step 2
-- drops (and which never limited phone). As CHECK constraints they hold for
-- every writer, the service role included. The one row in production on
-- 1 Oct fits them.
--
-- Leads carry free text about children and were kept forever. Ali chose 12
-- months: long enough to follow up any enquiry and see a full school year.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_name_length'
                 and conrelid = 'public.leads'::regclass) then
    alter table public.leads add constraint leads_name_length
      check (char_length(name) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_email_valid'
                 and conrelid = 'public.leads'::regclass) then
    alter table public.leads add constraint leads_email_valid
      check (char_length(email) between 3 and 320
             and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_phone_length'
                 and conrelid = 'public.leads'::regclass) then
    alter table public.leads add constraint leads_phone_length
      check (phone is null or char_length(phone) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_message_length'
                 and conrelid = 'public.leads'::regclass) then
    alter table public.leads add constraint leads_message_length
      check (char_length(message) between 1 and 4000);
  end if;
end
$$;

select cron.unschedule('purge-old-leads')
 where exists (select 1 from cron.job where jobname = 'purge-old-leads');

select cron.schedule(
  'purge-old-leads',
  '50 3 * * *',
  $cron$ delete from public.leads where created_at < now() - interval '12 months'; $cron$
);
