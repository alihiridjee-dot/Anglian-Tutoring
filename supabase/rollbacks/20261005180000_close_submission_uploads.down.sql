-- Rollback for 20261005180000_close_submission_uploads.sql. Run by hand.
--
-- Puts back both rules exactly as they were live on 5 Oct 2026, so any signed-in
-- user can upload any file under resources/submissions/<their id>/ again.
-- Safe to run twice.
drop policy if exists "resources bucket student upload" on storage.objects;
create policy "resources bucket student upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resources'::text
    and name ~~ (('submissions/'::text || (auth.uid())::text) || '/%'::text)
  );

drop policy if exists "resources bucket student delete acknowledged" on storage.objects;
create policy "resources bucket student delete acknowledged" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'resources'::text
    and name ~~ (('submissions/'::text || (auth.uid())::text) || '/%'::text)
    and exists (
      select 1
        from public.homework_submissions s
       where s.student_id = auth.uid()
         and s.acknowledged_at is not null
         and objects.name ~~ (((('submissions/'::text || (auth.uid())::text) || '/'::text)
                              || (s.resource_id)::text) || '/%'::text)
    )
  );
