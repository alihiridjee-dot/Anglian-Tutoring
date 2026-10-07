from __future__ import annotations
"""
Turn exam-board prose into a YouTube search query.

Spec points read like "Understand the overall reaction of aerobic respiration
as splitting of the respiratory substrate..." — 114 characters on average. Fed
to search verbatim they match nothing. What is wanted is the handful of content
words a teacher would put on the whiteboard, prefixed by the level and subject
so a GCSE point does not pull an undergraduate lecture.
"""
import re

LEVEL_LABEL = {"gcse": "GCSE", "alevel": "A Level", "igcse": "IGCSE"}
SUBJECT_LABEL = {"biology": "Biology", "chemistry": "Chemistry", "physics": "Physics"}

# Command verbs and scaffolding. These carry no topic, and they are the words
# spec prose is densest in.
NOISE = set(
    """
    a an and are as at be been being by can could do does for from had has have how i if in
    into is it its of on or should so such that the their them these this those to use used
    using was were what when where which who why will with within without your
    able about above across after against all also although among any because before below
    between both but during each either else enough ever every few further here however
    include included includes including into itself just least less like limited many may
    might more most much must need needs no non nor not now only other others our out over
    own per rather same see several shall since some student students than then there
    therefore they though through thus together too under until upon very via well were
    whether while whose
    appreciate apply appreciating aware awareness calculate carry compare comparison consider
    定 define demonstrate describe describing determine discuss distinguish evaluate examine
    explain explaining give given identify illustrate interpret know known knowing knowledge
    label list name outline predict recall recognise recognize relate represent select show
    sketch state suggest summarise summarize understand understanding understood write
    ability able content detail details eg example examples etc following idea ideas
    including limited practical range relevant required requirement specification terms
    topic topics candidates learners
    """.split()
)

# List markers and roman-numeral bullets that survive the parsers.
BULLET = re.compile(r"\b(?:[ivx]{1,4}|[a-h])\s*[\)\.]", re.I)
PAREN = re.compile(r"\([^)]*\)")
NONWORD = re.compile(r"[^a-z0-9'\-\s]+")


def keywords(text: str, limit: int = 7) -> list:
    t = text.lower()
    t = PAREN.sub(" ", t)          # "(A-level only)", "(HT only)" etc
    t = BULLET.sub(" ", t)
    t = t.replace("’", "'")
    t = NONWORD.sub(" ", t)
    out, seen = [], set()
    for w in t.split():
        w = w.strip("-'")
        if len(w) < 3 or w in NOISE or w in seen or w.isdigit():
            continue
        seen.add(w)
        out.append(w)
        if len(out) >= limit:
            break
    return out


# Points about HOW to work, not what to know: "keep appropriate records of
# experimental activities", "the limitations in experimental procedures". A
# content search on these lands on whatever practical the search engine likes —
# the earlier pass gave "keep appropriate records" a video about reflux. What
# they actually want is a practical-skills lesson.
SKILL_WORDS = {
    "apparatus", "practical", "practicals", "technique", "techniques", "hazard",
    "hazards", "risk", "risks", "safely", "safety", "record", "records", "recording",
    "precision", "accuracy", "accurate", "uncertainty", "uncertainties", "error",
    "errors", "graph", "graphs", "plotting", "software", "ict", "logger", "logging",
    "significant", "figures", "measurement", "measurements", "measuring", "limitation",
    "limitations", "procedure", "procedures", "validity", "reliability", "repeatability",
    "anomalous", "conclusions", "methodology", "results",
    "experimental", "experiment", "experiments", "observations", "evaluation", "refining", "presenting", "processing", "instruments", "sampling", "tabulate",
}


def is_skills(point: dict) -> bool:
    kw = keywords(point["title"], 8)
    if len(kw) < 2:
        return False
    hits = sum(1 for w in kw if w in SKILL_WORDS)
    # TWO hits, not one: a single generic word ("techniques", "experiment")
    # turns content points into skills points — "Imaging techniques" and "The
    # Michelson-Morley experiment" both got a free-fall practical that way.
    return hits >= 2 and hits / len(kw) >= 0.5


def _prefix(point: dict) -> str:
    return "{} {}".format(
        LEVEL_LABEL.get(point["level"], point["level"]),
        SUBJECT_LABEL.get(point["subject"], point["subject"]),
    )


def build(point: dict) -> list:
    """Primary query from the point itself; the topic query is the fallback for
    points too thin to search on ('Transmission media', 'Know the structure of
    the spinal cord' is fine, 'Required practical' is not)."""
    pre = _prefix(point)
    kw = keywords(point["title"])
    if is_skills(point):
        return [
            "{} practical skills {}".format(pre, " ".join(kw[:4])),
            "{} required practical apparatus techniques".format(pre),
            "{} practical skills uncertainty errors measurements".format(pre),
        ]
    topic_kw = keywords(re.sub(r"^[\d\.\w]+[:\s]+", "", point["topic"]), limit=5)

    queries = []
    if len(kw) >= 2:
        queries.append("{} {}".format(pre, " ".join(kw[:6])))
    # Thin point: lean on the topic for context.
    if len(kw) < 2 or len(" ".join(kw)) < 14:
        if topic_kw:
            queries.append("{} {} {}".format(pre, " ".join(topic_kw), " ".join(kw[:3])).strip())
    if topic_kw:
        fallback = "{} {}".format(pre, " ".join(topic_kw))
        if fallback not in queries:
            queries.append(fallback)
    if not queries:
        queries.append("{} {}".format(pre, point["title"][:60]))
    return queries
