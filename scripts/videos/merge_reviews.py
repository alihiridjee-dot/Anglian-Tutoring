from __future__ import annotations
"""
Fold the Sonnet verdicts back into one list of videos to write.

    python3 scripts/videos/merge_reviews.py

Reads out/review/verdict-NN.json next to each batch. A verdict is refused (and
the batch reported) if it skips a point, names a point outside the batch, or
names a video id that was not offered for that point. Writes:
  out/final.json   one chosen, verified video per spec point
  out/none.json    points no candidate fits (for a second search)
"""
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
REVIEW = os.path.join(OUT, "review")


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="assignments.json")
    ap.add_argument("--prefix", default="batch")
    ap.add_argument("--suffix", default="", help="final<suffix>.json / none<suffix>.json")
    args = ap.parse_args()
    rows = {r["spec_point_id"]: r for r in json.load(open(os.path.join(OUT, args.input)))}
    batches = sorted(f for f in os.listdir(REVIEW)
                     if f.endswith(".ids.json") and f.startswith(args.prefix + "-"))
    final, none, problems = [], [], []
    counts = Counter()
    for b in batches:
        n = b.split(".")[0][len(args.prefix) + 1:]
        offered = json.load(open(os.path.join(REVIEW, b)))
        vpath = os.path.join(REVIEW, f"verdict-{n}.json" if args.prefix == "batch" else f"verdict-{args.prefix}-{n}.json")
        if not os.path.exists(vpath):
            problems.append(f"batch {n}: no verdict file")
            continue
        try:
            verdicts = json.load(open(vpath))
        except json.JSONDecodeError as e:
            problems.append(f"batch {n}: bad JSON ({e})")
            continue
        seen = set()
        for v in verdicts:
            pid, kind, vid = v.get("spec_point_id"), v.get("verdict"), v.get("video_id")
            if pid not in offered:
                problems.append(f"batch {n}: unknown point {pid}")
                continue
            seen.add(pid)
            r = rows[pid]
            if kind == "none":
                counts["none"] += 1
                none.append({**r, "reason": v.get("reason")})
                continue
            if kind not in ("keep", "switch") or vid not in offered[pid]:
                problems.append(f"batch {n}: {r['code']} names {vid!r}, not offered")
                continue
            counts["keep" if vid == r["video_id"] else "switch"] += 1
            if vid == r["video_id"]:
                chosen = {"id": vid, "title": r["video_title"], "channel": r["channel"],
                          "duration": r.get("duration")}
            else:
                chosen = next(a for a in r["alternates"] if a["id"] == vid)
            final.append({
                "spec_point_id": pid, "code": r["code"], "point": r["point"],
                "subject": r["subject"], "level": r["level"], "board": r["board"],
                "topic": r["topic"], "video_id": vid,
                "url": f"https://www.youtube.com/watch?v={vid}",
                "video_title": chosen["title"], "channel": chosen["channel"],
                "duration": chosen.get("duration"), "verdict": kind,
                "reason": v.get("reason"),
            })
        for pid in offered:
            if pid not in seen:
                problems.append(f"batch {n}: {rows[pid]['code']} has no verdict")

    with open(os.path.join(OUT, f"final{args.suffix}.json"), "w") as f:
        json.dump(final, f, indent=1)
    with open(os.path.join(OUT, f"none{args.suffix}.json"), "w") as f:
        json.dump(none, f, indent=1)
    print(f"keep {counts['keep']}, switch {counts['switch']}, none {counts['none']}")
    print(f"final: {len(final)} points with a video, {len({x['video_id'] for x in final})} distinct videos")
    if problems:
        print(f"{len(problems)} problems:")
        for p in problems[:40]:
            print("  " + p)


if __name__ == "__main__":
    main()
