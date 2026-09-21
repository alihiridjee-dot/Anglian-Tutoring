-- Cambridge (CAIE) and OxfordAQA join Pearson Edexcel as International GCSE
-- boards.
--
-- iGCSE is a level, not a board (20260729191440): topics, resources, weekly
-- focus, enrolments and both plan tables are keyed by (level, board, subject),
-- and all six share the one `board` type. A new board is therefore a new value
-- of that type and nothing more — no table, relation or policy. The rows it
-- will label already have their RLS, and those policies scope by subject and
-- enrolment, never by board, so a Cambridge student is isolated exactly as an
-- Edexcel one is.
--
-- OxfordAQA is a value of its own rather than "aqa at igcse". It is a separate
-- awarding body, it is the name printed on the student's paper (which is how
-- onboarding tells them to check), and it would collide with UK AQA the day
-- International A-Level is added.
--
-- Nothing is offered on either board until curriculum is loaded for it: every
-- student-facing picker is gated on curriculum_coverage(), so both stay out of
-- sight until a tutor syncs a spec.
--
-- Postgres will not let a new enum value be used in the transaction that adds
-- it, so this migration only adds.
--
-- Rollback: supabase/rollbacks/20260921101610_cambridge_and_oxfordaqa_boards.down.sql

alter type public.board add value if not exists 'cambridge';
alter type public.board add value if not exists 'oxford_aqa';
