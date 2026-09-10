-- Approval is automatic, and it means "complete", not "a person read it".
--
-- The old rule was that a tutor approves every exemplar. There is no screen to
-- do that on, nothing ever set the column, and so the library sat at 512 rows
-- and nought approved — which meant retrieval found nothing for every point and
-- generation silently fell back to curriculum-only. An approval gate nobody can
-- pass is not a safeguard, it is an outage.
--
-- So the database decides, from the row itself. A question is approved when it
-- can actually be used: it has its text, its marks, its own mark scheme, no
-- unresolved flag, and no missing figure. Anything short of that is not
-- approved, which is the same set retrieval was already filtering down to.
--
-- Because the rule is re-applied on every write, re-ingesting a paper mends
-- rows and damages them symmetrically: a row that gains its mark scheme becomes
-- approved, a row whose text goes missing stops being approved. That is why the
-- separate invalidate-on-change trigger goes: it existed to stop a human's
-- approval outliving the text it was given to, and there is no human approval
-- left for it to protect.
--
-- There is deliberately no manual veto. If one is wanted later it belongs in a
-- column of its own — a suppressed_at that this rule never touches — rather
-- than in approved_at, which now carries a single, checkable meaning.

drop trigger if exists invalidate_changed_exemplar_approval on public.exam_exemplars;
drop function if exists private.invalidate_changed_exemplar_approval();

create function private.approve_complete_exemplar()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.needs_image = false
     and cardinality(new.flags) = 0
     and length(btrim(coalesce(new.prompt, ''))) > 20
     and length(btrim(coalesce(new.mark_scheme, ''))) > 0
     and coalesce(new.marks, 0) > 0
     -- A multiple-choice question without its options is not answerable, however
     -- complete the rest of it looks.
     and (new.question_format is distinct from 'mcq'
          or jsonb_array_length(coalesce(new.options, '[]'::jsonb)) >= 2)
  then
    if new.approved_at is null then
      new.approved_at := now();
    end if;
  else
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end;
$$;

create trigger approve_complete_exemplar
  before insert or update on public.exam_exemplars
  for each row execute function private.approve_complete_exemplar();

comment on column public.exam_exemplars.approved_at is
  'Set by the database when the row is complete enough to use: text, marks, its '
  'own mark scheme, no flags, no missing figure. Not a record of human review.';

-- Apply the rule to what is already there. A no-op update is enough: the
-- trigger re-reads every row and decides.
update public.exam_exemplars set flags = flags;
