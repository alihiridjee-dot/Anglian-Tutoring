# Video check: one YouTube video per IGCSE spec point

Students on Cambridge IGCSE (Biology 0610, Chemistry 0620, Physics 0625) and
Edexcel IGCSE Physics (4PH1) get one video on each spec point, shown in the
"Watch" column of their weekly task list. A search picked a video for each
point. Your job is to make sure the video really teaches that point.

## Your batch

Read your batch file top to bottom. Each item has:

- the spec point: code, wording (`Point`, sometimes `Detail`) and topic;
- `PICK`: the video the search chose;
- `ALT1`…`ALT6`: runners-up. Each one exists and plays on our site.

Every video line reads `[video id] "title" — channel · length · age`.

## Decide, for every item

- **keep**: the PICK teaches this point's content at GCSE/IGCSE level.
- **switch**: an ALT is clearly better. That means it is more specific to the
  point, at the right level, or from a stronger teaching channel. Give the ALT's
  video id.
- **none**: neither the PICK nor any ALT teaches this point.

What counts as teaching the point:

- The title (and snippet) must show the same science. A broader video is fine
  when its title shows that it covers this point. For example, "Classification
  of living things" covers "the binomial system". A video on a neighbouring idea
  does not count.
- Right level: GCSE or IGCSE. Reject A-level-only, university or medical-school
  depth.
- Right subject: no Chemistry video on a Physics point, and so on.
- Not: past-paper walkthroughs, quizzes, songs, Shorts, livestream recordings,
  non-English videos, or videos for a different country's syllabus when a UK or
  IGCSE one is on offer.
- Practical and skills points want a video on that practical or skill.
- Cambridge "S" codes (e.g. 2.1.3S) are Supplement (extended) content. They
  still want a GCSE/IGCSE-level video.

When several are good, prefer in this order:

1. A lesson on exactly this point from a UK GCSE/IGCSE teaching channel
   (Cognito, Freesciencelessons, Save My Exams, Primrose Kitten, Science
   Sauce, an IGCSE channel and similar).
2. A lesson on exactly this point from a general science channel (Amoeba
   Sisters, FuseSchool, Khan Academy and similar).
3. A broader topic lesson that clearly includes this point.

Keep the PICK when it is as good as the alternatives. Switch only for a clear
gain.

## Rules

- Never invent or alter a video id. Use only ids printed in that item.
- Judge every item. Do not skip any.
- Do not open the web, run code or touch any file except your verdict file.

## Write your verdicts

Write a JSON array to your verdict file (the path is in your task). It has one
object per item, in the batch's order:

```json
[
  {"spec_point_id": "…", "verdict": "keep", "video_id": "<the PICK id>", "reason": "few words"},
  {"spec_point_id": "…", "verdict": "switch", "video_id": "<an ALT id>", "reason": "few words"},
  {"spec_point_id": "…", "verdict": "none", "video_id": null, "reason": "few words"}
]
```

Then reply with a single line: the counts of keep, switch and none.

## A-level batches (added 11 Oct 2026)

Items headed "AQA / OCR / Edexcel / Cambridge A Level" are the A-level
courses (AQA 7402/7405/7408, OCR A H420/H432/H556, Edexcel 9BN0/9CH0/9PH0,
Cambridge 9700/9701/9702). Everything above applies, with the level swapped:

- Right level is **A level / AS level**. A GCSE video is too shallow unless
  the point is plainly GCSE content restated. University depth is fine only
  when the title shows exactly this point and no A-level option is offered.
- Cambridge "AS & A Level" videos count as a UK board, not a foreign syllabus.
- Prefer UK A-level channels (Allery Chemistry, Physics Online, Miss Estruch,
  Primrose Kitten, Save My Exams, Study Mind, Snap Revise, Mr Exham, Eliot
  Rintoul, Science Shorts and similar), then strong general channels (Khan
  Academy, Professor Dave, The Organic Chemistry Tutor, Amoeba Sisters).
- Reject topic-level matches: a video titled "Enzymes" does not teach
  "competitive inhibitors and their effect on Vmax"; answer none.
