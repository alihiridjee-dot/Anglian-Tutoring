from __future__ import annotations
"""
Second chance for the points the Sonnet check found nothing for.

    python3 scripts/videos/second_pass.py

Reads out/none.json. For each point it runs new searches worded differently
(board-named IGCSE, plain GCSE, no level at all), ranks the new pool with the
same scorer, drops every video the checker already turned down for that point,
verifies the rest over oEmbed, and writes out/assignments2.json in the same
shape as assignments.json. make_batches.py --input assignments2.json --prefix r2
then makes its review batches.
"""
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channels as CH
import harvest as H
import match as M
import queries as Q
import verify as V
import ytsearch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
BOARD = {"cambridge": "Cambridge IGCSE", "edexcel": "Edexcel IGCSE"}


def extra_queries(p: dict) -> list:
    subj = Q.SUBJECT_LABEL[p["subject"]]
    kw = Q.keywords(p["title"], 6)
    topic_kw = Q.keywords(p["topic"], 4)
    words = " ".join(kw[:5]) or " ".join(topic_kw)
    return [
        f"{BOARD[p['board']]} {subj} {words}",
        f"GCSE {subj} {words}",
        f"{subj} {words}",
        f"{BOARD[p['board']]} {subj} {' '.join(topic_kw)} {' '.join(kw[:2])}".strip(),
    ]


def main() -> None:
    none = [{**p, "title": p.get("point") or p.get("title"), "description": p.get("point_description", "")}
            for p in json.load(open(os.path.join(OUT, "none.json")))]
    offered = {}
    for f in os.listdir(os.path.join(OUT, "review")):
        if f.endswith(".ids.json"):
            offered.update(json.load(open(os.path.join(OUT, "review", f))))

    wanted = []
    for p in none:
        for q in extra_queries(p):
            if H.cached(q) is None and q not in wanted:
                wanted.append(q)
    print(f"{len(none)} points, {len(wanted)} new searches")
    os.makedirs(H.CACHE, exist_ok=True)
    for q in wanted:
        H.fetch(q, len(wanted))

    out, probe = [], []
    ranked = []
    for p in none:
        kw, topic_kw = Q.keywords(p["title"], 10), Q.keywords(p["topic"], 6)
        pool, seen = [], set(offered.get(p["spec_point_id"], []))
        for qi, q in enumerate(Q.build(p) + extra_queries(p)):
            res = (H.cached(q) or {}).get("results") or []
            for i, c in enumerate(res):
                if c["id"] in seen:
                    continue
                seen.add(c["id"])
                pool.append((c, i, len(res), qi > 0))
        scored = [(M.score(p, c, kw, topic_kw, i, n, fb, Counter()), c) for (c, i, n, fb) in pool]
        scored = sorted([x for x in scored if x[0] > -50], key=lambda x: -x[0])
        probe.extend(c["id"] for _, c in scored[:10])
        ranked.append((p, scored))
    V.check_many(probe)

    for p, scored in ranked:
        good = [(s, c) for s, c in scored[:10] if V.ok(c["id"])]
        if not good:
            continue
        (s, c), rest = good[0], good[1:7]
        meta = V.load()
        out.append({
            "spec_point_id": p["spec_point_id"], "code": p["code"], "point": p["title"],
            "topic": p["topic"], "subject": p["subject"], "level": p["level"],
            "board": p["board"], "syllabus": p.get("syllabus"),
            "video_id": c["id"], "url": f"https://www.youtube.com/watch?v={c['id']}",
            "video_title": meta.get(c["id"], {}).get("title") or c["title"],
            "channel": meta.get(c["id"], {}).get("channel") or c["channel"],
            "tier": CH.tier(c.get("channel", "")), "duration": c.get("duration"),
            "published": c.get("published"), "snippet": (c.get("description") or "")[:200],
            "score": round(s, 2), "point_description": p.get("description", ""),
            "alternates": [{
                "id": c2["id"],
                "title": meta.get(c2["id"], {}).get("title") or c2["title"],
                "channel": meta.get(c2["id"], {}).get("channel") or c2["channel"],
                "duration": c2.get("duration"), "published": c2.get("published"),
                "snippet": (c2.get("description") or "")[:200], "score": round(s2, 2),
            } for s2, c2 in rest],
        })
    with open(os.path.join(OUT, "assignments2.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(f"{len(out)}/{len(none)} points have new candidates")


if __name__ == "__main__":
    main()
