from __future__ import annotations
"""
Split out/assignments.json into review batches for the Sonnet check.

    python3 scripts/videos/make_batches.py [--size 60]

Each batch is a plain-text file (review/batch-NN.txt) a reviewer reads top to
bottom, plus review/batch-NN.ids.json: the spec points in it and, per point,
every video id the reviewer may choose (the pick and its verified runners-up).
merge_reviews.py refuses any verdict that names an id outside that list.
"""
import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
REVIEW = os.path.join(OUT, "review")


def mmss(sec) -> str:
    if not sec:
        return "?:??"
    return f"{sec // 60}:{sec % 60:02d}"


def line(tag: str, v: dict) -> str:
    return (f'{tag} [{v["id"]}] "{v["title"]}" — {v["channel"]} · {mmss(v.get("duration"))}'
            f' · {v.get("published") or "date unknown"}')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=60)
    ap.add_argument("--input", default="assignments.json")
    ap.add_argument("--prefix", default="batch")
    args = ap.parse_args()

    rows = json.load(open(os.path.join(OUT, args.input)))
    os.makedirs(REVIEW, exist_ok=True)
    for f in os.listdir(REVIEW):
        if f.startswith(args.prefix + "-"):
            os.remove(os.path.join(REVIEW, f))

    n = 0
    for start in range(0, len(rows), args.size):
        n += 1
        chunk = rows[start:start + args.size]
        text, ids = [], {}
        for i, r in enumerate(chunk, 1):
            course = {"cambridge": "Cambridge IGCSE", "edexcel": "Edexcel IGCSE"}[r["board"]]
            text.append(f'### {i}. {r["code"]} ({course} {r["subject"].title()}) | spec_point_id: {r["spec_point_id"]}')
            text.append(f'Point: {r["point"]}')
            if r.get("point_description") and r["point_description"] != r["point"]:
                text.append(f'Detail: {r["point_description"]}')
            text.append(f'Topic: {r["topic"]}')
            pick = {"id": r["video_id"], "title": r["video_title"], "channel": r["channel"],
                    "duration": r.get("duration"), "published": r.get("published")}
            text.append(line("PICK", pick))
            if r.get("snippet"):
                text.append(f'  snippet: {r["snippet"]}')
            for j, a in enumerate(r.get("alternates") or [], 1):
                text.append(line(f"ALT{j}", a))
                if a.get("snippet"):
                    text.append(f'  snippet: {a["snippet"]}')
            text.append("")
            ids[r["spec_point_id"]] = [r["video_id"]] + [a["id"] for a in r.get("alternates") or []]
        with open(os.path.join(REVIEW, f"{args.prefix}-{n:02d}.txt"), "w") as f:
            f.write("\n".join(text))
        with open(os.path.join(REVIEW, f"{args.prefix}-{n:02d}.ids.json"), "w") as f:
            json.dump(ids, f)
    print(f"{len(rows)} points in {n} batches of up to {args.size}")


if __name__ == "__main__":
    main()
