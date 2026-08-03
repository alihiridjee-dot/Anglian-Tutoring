-- A lapse is meant to mean "knew it, then got it wrong". Until now a confidence
-- self-rating below 34 sent FSRS a `Rating.Again`, so dragging a topic into
-- "Not confident" was recorded identically to failing a test — and the mastery
-- model charged 5 marks per lapse, permanently. Across this database that is 465
-- self-rating "lapses" against exactly 1 real one (a single MCQ).
--
-- Recount every card's lapse counter from the ledger, counting only failures
-- backed by a mark (homework or MCQ). Stability, difficulty and due dates are
-- untouched — FSRS never reads the lapse count when scheduling, so this changes
-- what we charge the student, not when anything comes back.
--
-- Not a full FSRS replay: FSRS only counts a lapse when the card was already in
-- the Review state, so a strict replay could come out marginally lower. With one
-- candidate row in the whole database the distinction is worth nothing.

with real_lapses as (
  select student_id, spec_point_id, count(*) as n
  from student_spec_point_reviews
  where source in ('homework', 'mcq') and rating = 1
  group by student_id, spec_point_id
)
update student_spec_point_schedule s
set card = jsonb_set(s.card, '{lapses}', to_jsonb(coalesce(r.n, 0))),
    updated_at = now()
from (select * from student_spec_point_schedule) src
left join real_lapses r
  on r.student_id = src.student_id and r.spec_point_id = src.spec_point_id
where s.student_id = src.student_id
  and s.spec_point_id = src.spec_point_id
  and coalesce((s.card->>'lapses')::int, 0) <> coalesce(r.n, 0);
