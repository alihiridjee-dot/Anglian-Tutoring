-- A short prompt is not an incomplete one.
--
-- The approval rule asked for more than 20 characters of prompt, which reads as
-- a sensible guard against a fragment until you meet a continuation part: AQA
-- writes "Explain why." as a whole question, because the part before it set the
-- scene and that scene is sitting in shared_context. Three such questions —
-- seven marks, each with its own mark scheme — were held back by the length of
-- their own wording.
--
-- So measure what the row actually carries. The prompt must still be there,
-- because a row with no question is nothing, but the stem it depends on counts
-- towards whether there is enough here to answer.

create or replace function private.approve_complete_exemplar()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.needs_image = false
     and cardinality(new.flags) = 0
     and length(btrim(coalesce(new.prompt, ''))) > 0
     and length(btrim(coalesce(new.prompt, '') || ' ' ||
                      coalesce(new.shared_context, ''))) > 20
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

-- Re-decide every row that is already here under the corrected rule.
update public.exam_exemplars set flags = flags;
