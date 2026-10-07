from __future__ import annotations
"""
Choose one video per spec point from the harvested candidates.

    python3 scripts/videos/match.py

Ranking, then verification — in that order, because oEmbed is the expensive
step: the top candidate is checked, and only if it 404s or refuses to embed
does the next one get a turn. Output is out/assignments.json.
"""
import argparse
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channels as CH
import harvest as H
import queries as Q
import verify as V

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

SUBJECTS = {"biology", "chemistry", "physics"}
OTHER_SUBJECT_WORDS = {
    "biology": ("chemistry", "physics"),
    "chemistry": ("biology", "physics"),
    "physics": ("biology", "chemistry"),
}
# Titles that are not a lesson on the point.
JUNK = re.compile(
    r"\b(past paper|exam question|walkthrough|predicted paper|paper [123] (?:revision )?live|"
    r"livestream|live stream|asmr|#shorts|shorts|quiz|kahoot|unboxing|reaction video|"
    r"my results|results day|how i got|study with me|revision timetable|"
    r"in 60 seconds|in 30 seconds|in a minute|meme)\b",
    re.I,
)
GCSE_RE = re.compile(r"\b(gcse|igcse|ks4|key stage 4|year 10|year 11)\b", re.I)
ALEVEL_RE = re.compile(r"\b(a[\s\-]?level|as[\s\-]level|a2|ks5|sixth form|year 12|year 13)\b", re.I)
BOARDS = {"aqa": r"\baqa\b", "edexcel": r"\b(edexcel|pearson|snab)\b", "ocr": r"\bocr\b",
          "cambridge": r"\b(cambridge|caie|cie)\b"}
YEARS = re.compile(r"(\d+)\s+(year|month|week|day)s?\s+ago", re.I)
# Other countries' syllabuses. The teaching is usually fine, the emphasis is
# not ours, so this discounts rather than rejects.
FOREIGN = re.compile(
    r"\b(ib (?:biology|chemistry|physics|diploma)|\bap (?:biology|chemistry|physics)\b|neet|"
    r"cbse|icse|class (?:9|10|11|12)|jee|cambridge (?:as|a2)|"
    r"hsc|waec|jamb|mcat|usmli|usmle|nclex|leaving cert|sat subject)\b",
    re.I,
)


def mostly_english(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return True
    return sum(1 for c in letters if c.isascii()) / len(letters) >= 0.7


def views_num(label: str) -> int:
    m = re.search(r"([\d,\.]+)\s*([KM]?)", label or "")
    if not m:
        return 0
    try:
        n = float(m.group(1).replace(",", ""))
    except ValueError:
        return 0
    return int(n * {"K": 1e3, "M": 1e6, "": 1}[m.group(2)])


def age_years(label: str) -> float:
    m = YEARS.search(label or "")
    if not m:
        return 99.0
    n, unit = float(m.group(1)), m.group(2).lower()
    return n * {"year": 1.0, "month": 1 / 12, "week": 1 / 52, "day": 1 / 365}[unit]


def score(point: dict, cand: dict, kw: list, topic_kw: list, rank: int, n: int,
          from_fallback: bool, topic_uses: Counter) -> float:
    title = cand.get("title", "") or ""
    desc = cand.get("description", "") or ""
    hay = (title + " " + desc).lower()
    subject, level = point["subject"], point["level"]

    # ── Hard rejections ──────────────────────────────────────────────────────
    dur = cand.get("duration")
    if dur is not None and dur < 75:
        return -99.0                                    # Short, not a lesson
    if dur is not None and dur > 7200:
        return -99.0                                    # 2h+ revision marathon
    others = OTHER_SUBJECT_WORDS[subject]
    if any(o in hay for o in others) and subject not in hay:
        return -99.0                                    # cross-subject leak
    if level in ("gcse", "igcse") and ALEVEL_RE.search(title) and not GCSE_RE.search(title):
        return -99.0
    if level == "alevel" and GCSE_RE.search(title) and not ALEVEL_RE.search(title):
        return -99.0
    if not mostly_english(title):
        return -99.0

    s = 0.0
    s += 3.0 * CH.weight(cand.get("channel", ""))
    tier = CH.tier(cand.get("channel", ""))
    if tier == "uni" and level in ("gcse", "igcse"):
        s -= 1.2                                        # med-school depth at GCSE

    hit = sum(1 for w in kw if w in hay)
    s += 3.2 * (hit / len(kw)) if kw else 0.0
    if topic_kw:
        s += 1.0 * (sum(1 for w in topic_kw if w in hay) / len(topic_kw))

    if level in ("gcse", "igcse") and GCSE_RE.search(hay):
        s += 1.3
        if level == "igcse" and re.search(r"\bigcse\b", hay):
            s += 0.4
    elif level == "alevel" and ALEVEL_RE.search(hay):
        s += 1.3

    board = point.get("board") or ""
    for b, pat in BOARDS.items():
        if re.search(pat, hay):
            s += 0.6 if b == board else -0.35

    if dur is not None:
        if 180 <= dur <= 1500:
            s += 0.5
        elif dur > 2700:
            s -= 0.4

    a = age_years(cand.get("published", ""))
    s += 0.35 if a <= 2 else (0.18 if a <= 5 else 0.0)
    v = views_num(cand.get("views", ""))
    if v > 0:
        s += min(0.45, math.log10(v + 1) / 12)

    s += 0.6 * (1 - rank / max(n, 1))                   # search rank is a signal
    if from_fallback:
        s -= 0.7                                        # topic query, not the point
    if JUNK.search(title):
        s -= 2.5
    if FOREIGN.search(hay):
        s -= 1.1
    if dur is None:
        s -= 0.3                                        # live/upcoming, not a lesson
    s -= min(2.0, 0.3 * topic_uses[cand["id"]])         # spread within a topic
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    points = json.load(open(os.path.join(OUT, "points.json")))

    # Rank everything first, so one oEmbed pass can verify every top pick at once.
    ranked = {}
    for p in points:
        qs = Q.build(p)
        kw, topic_kw = Q.keywords(p["title"], 10), Q.keywords(p["topic"], 6)
        pool, seen = [], set()
        for qi, q in enumerate(qs):
            rec = H.cached(q) or {}
            res = rec.get("results") or []
            for i, c in enumerate(res):
                if c["id"] in seen:
                    continue
                seen.add(c["id"])
                pool.append((c, i, len(res), qi > 0))
        ranked[p["id"]] = (p, kw, topic_kw, pool)

    # First pass: provisional pick per point, ignoring spread, to know what to verify.
    empty = Counter()
    probe = []
    for pid, (p, kw, topic_kw, pool) in ranked.items():
        scored = [
            (score(p, c, kw, topic_kw, i, n, fb, Counter()), c)
            for (c, i, n, fb) in pool
        ]
        scored = [x for x in scored if x[0] > -50]
        scored.sort(key=lambda x: -x[0])
        if not scored:
            empty[p["subject"] + "/" + p["level"]] += 1
        probe.extend(c["id"] for _, c in scored[:7])

    print(f"verifying {len(set(probe))} distinct candidate videos…", flush=True)
    V.check_many(probe)

    # Second pass: assign in course order, now with the spread penalty and the
    # verification verdict in hand.
    topic_uses = defaultdict(Counter)
    assignments, unmatched = [], []
    for p in points:
        _, kw, topic_kw, pool = ranked[p["id"]]
        uses = topic_uses[p["topic_id"]]
        scored = [
            (score(p, c, kw, topic_kw, i, n, fb, uses), c) for (c, i, n, fb) in pool
        ]
        scored = [x for x in scored if x[0] > -50]
        scored.sort(key=lambda x: -x[0])
        pick = None
        for s, c in scored:
            if V.ok(c["id"]):
                pick = (s, c)
                break
        if pick is None:
            # Nothing in the top slice was verified; check deeper before giving up.
            more = [c["id"] for _, c in scored[:12]]
            if more:
                V.check_many(more)
                for s, c in scored:
                    if V.ok(c["id"]):
                        pick = (s, c)
                        break
        if pick is None:
            unmatched.append(p)
            continue
        s, c = pick
        uses[c["id"]] += 1
        # Runners-up for the Sonnet check: verified (oEmbed 200) only, so a
        # reviewer can switch to one of them but never to an id nobody checked.
        alternates = []
        for s2, c2 in scored:
            if c2["id"] == c["id"] or not V.ok(c2["id"]):
                continue
            alternates.append({
                "id": c2["id"],
                "title": V.load().get(c2["id"], {}).get("title") or c2["title"],
                "channel": V.load().get(c2["id"], {}).get("channel") or c2["channel"],
                "duration": c2.get("duration"),
                "published": c2.get("published"),
                "snippet": (c2.get("description") or "")[:200],
                "score": round(s2, 2),
            })
            if len(alternates) >= 6:
                break
        assignments.append(
            {
                "spec_point_id": p["id"],
                "code": p["code"],
                "point": p["title"][:160],
                "topic": p["topic"],
                "subject": p["subject"],
                "level": p["level"],
                "board": p["board"],
                "syllabus": p["syllabus"],
                "video_id": c["id"],
                "url": f"https://www.youtube.com/watch?v={c['id']}",
                "video_title": V.load().get(c["id"], {}).get("title") or c["title"],
                "channel": V.load().get(c["id"], {}).get("channel") or c["channel"],
                "tier": CH.tier(c.get("channel", "")),
                "duration": c.get("duration"),
                "published": c.get("published"),
                "snippet": (c.get("description") or "")[:200],
                "score": round(s, 2),
                "point_description": (p.get("description") or "")[:400],
                "alternates": alternates,
            }
        )

    with open(os.path.join(OUT, "assignments.json"), "w") as f:
        json.dump(assignments, f, indent=1)
    with open(os.path.join(OUT, "unmatched.json"), "w") as f:
        json.dump(unmatched, f, indent=1)

    print(f"\nassigned {len(assignments)}/{len(points)} spec points")
    print(f"distinct videos: {len({a['video_id'] for a in assignments})}")
    print("tier mix: " + ", ".join(f"{k}={v}" for k, v in Counter(a["tier"] for a in assignments).most_common()))
    if unmatched:
        print(f"unmatched: {len(unmatched)} — see out/unmatched.json")


if __name__ == "__main__":
    main()
