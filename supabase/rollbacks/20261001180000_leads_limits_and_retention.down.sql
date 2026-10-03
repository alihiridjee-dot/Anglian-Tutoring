-- Hand-run rollback for 20261001180000_leads_limits_and_retention.sql.
select cron.unschedule('purge-old-leads')
 where exists (select 1 from cron.job where jobname = 'purge-old-leads');

alter table public.leads drop constraint if exists leads_name_length;
alter table public.leads drop constraint if exists leads_email_valid;
alter table public.leads drop constraint if exists leads_phone_length;
alter table public.leads drop constraint if exists leads_message_length;
