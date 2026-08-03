-- Distinguish the two lanes a weekly-plan point can come from.
--
-- A generated week is built from the year plan and holds both: the teach spine's
-- share of the core curriculum, and the focus lane's revisits of points the
-- student is weak on. Both were written as `ai`, so once the plan was saved
-- there was no way to tell them apart — the panel could only group by topic, and
-- a student couldn't see which half of their week was new material and which was
-- coming back round.
--
-- Storing the lane (rather than re-deriving it from the roadmap on render) keeps
-- past weeks readable: the focus lane is recomputed live from mastery, so a
-- point that has since settled no longer appears in any band and its lane would
-- be unrecoverable.
--
-- `ai` stays valid — every existing row keeps its meaning ("the platform chose
-- this"), and nothing needs backfilling.
alter type plan_point_origin add value if not exists 'core';
alter type plan_point_origin add value if not exists 'focus';
