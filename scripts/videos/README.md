# Spec-point videos

Every spec point should have one video a student can play: in the "Watch"
column of the weekly task list and under "Syllabus Videos" on the spec point.
This is the pipeline that finds them. It was first built for the Tutoring Hub
(September 2026) and adapted here on 6 October 2026 to fill the IGCSE gap:
Cambridge IGCSE Biology, Chemistry and Physics (0610/0620/0625) and Edexcel
IGCSE Physics (4PH1) had no videos at all.

```bash
set -a && . ./.env && set +a
python3 scripts/videos/export_points.py         # DB → out/points.json (points with no video)
python3 scripts/videos/harvest.py --fallbacks   # YouTube search → out/cache/
python3 scripts/videos/match.py                 # rank + oEmbed → out/assignments.json
python3 scripts/videos/make_batches.py          # → out/review/batch-NN.txt
#   one Sonnet agent per batch, given REVIEW_BRIEF.md → out/review/verdict-NN.json
python3 scripts/videos/merge_reviews.py         # → out/final.json + out/none.json
python3 scripts/videos/second_pass.py           # new searches for none.json → out/assignments2.json
python3 scripts/videos/make_batches.py --input assignments2.json --prefix r2 --size 21
#   Sonnet agents again → out/review/verdict-r2-NN.json
python3 scripts/videos/merge_reviews.py --input assignments2.json --prefix r2 --suffix 2
python3 scripts/videos/apply.py                 # preview: what would be written
python3 scripts/videos/apply.py --write         # write, with a manifest for the undo
python3 scripts/videos/audit.py --sample 0      # read back and re-verify every link
```

Every stage is cached and resumable, so a re-run only pays for what changed.
`export_points.py` lists the courses it fills in `TARGETS`; edit that list for
another course. `out/` is gitignored.

## The rules this exists to enforce

**Never write a video id a model produced.** A plausible-looking 11-character
YouTube id is almost always invented: in July 2026 nearly every Biology video
on the site was one. Ids here come only from scraping YouTube's results page
(`ytsearch.py`), which returns ids that exist by construction. The Sonnet
check can only choose among the ids printed in its batch, and
`merge_reviews.py` refuses any verdict that names another.

**oEmbed 200 is the only acceptable verdict.** `404` is a dead id. `401` is the
one that hurts: the uploader disabled embedding, so the video plays on
youtube.com and shows "Video unavailable" in our player. `apply.py` checks every
pick again right before it writes.

**The text under a video is for students.** The title is the video's real
YouTube title and the description is the channel name, nothing else. Both show
on the spec point page. (Until 6 October, 403 rows showed the internal note
"topic-level match — review" to students.)

**One video row per spec point, the same shape as every other curriculum
video.** A `resources` row (kind `video`, owner `1111…`, origin `tutor`,
approved, `spec_point_id` set) plus its `resource_spec_points` row. The page
renders a video only through the join row; the planner's coverage flag reads
`spec_point_id`, so each point needs both.

**Every write can be undone exactly.** `apply.py --write` saves every new row
id to `out/manifest-<time>.json` first. Copy it to `papers/backups/`. The undo
is `delete from resources where id in (<the manifest's ids>)`; the join rows go
with them (`on delete cascade`).

## Ranking

`match.py` scores each candidate on channel trust (`channels.py`: UK
spec-aligned > excellent-but-spec-agnostic > university/medical), keyword
overlap with the spec point and its topic, level fit, exam board, duration,
recency and search rank. Hard rejections: Shorts, 2h+ streams, cross-subject
leaks, an A-level video on a GCSE/IGCSE point (and the reverse), non-English
titles.

For IGCSE: Cambridge counts as a board, not a foreign syllabus; IGCSE points
follow the GCSE level rules; and the IGCSE channels that kept turning up in
the harvest were added to `channels.py`.

`queries.py` turns long exam-board prose into something searchable. Points
about *how to work* rather than *what to know* get a practical-skills query
instead.

## The Sonnet check

Keyword ranking finds a live video on a neighbouring idea surprisingly often.
On the 6 October IGCSE run the check kept 771 picks, switched 347 to a better
runner-up and found nothing for 42. The second pass then searched again for
those 42 with different wording. `REVIEW_BRIEF.md` is the checker's exact job:
one agent per batch of about 60 points, on Sonnet.
