from __future__ import annotations
"""
Find every dead or non-embeddable video on the site, and the spec points it sits on.

    set -a && . ./.env && set +a && python3 scripts/videos/dead.py            # report
    set -a && . ./.env && set +a && python3 scripts/videos/dead.py --export   # + queue them

Read-only. Checks every distinct video id (all levels) over oEmbed, then checks
the failures a second time, so a YouTube blip is not reported as dead. Writes
out/dead-videos.tsv: one line per dead row and spec point.

--export adds those spec points to out/points.json (same shape as
export_points.py, so run that first if you are also filling gaps) and writes
out/dead_map.json: spec point id -> the dead `resources` row ids. The normal
harvest / match / review / merge steps then find a replacement for each, and
replace_dead.py swaps it into the same row.
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ytsearch
from export_points import TARGETS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SYLLABUS = {(l, b, s): code for rows in TARGETS.values() for (l, b, s, code) in rows}


def get_all(url: str, key: str, path: str, params: dict) -> list:
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({**params, "limit": 1000, "offset": offset})
        req = urllib.request.Request(f"{url}/rest/v1/{path}?{q}",
                                     headers={"apikey": key, "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.loads(r.read().decode())
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        offset += len(batch)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", action="store_true", help="queue the dead points for a new search")
    args = ap.parse_args()
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    videos = get_all(url, key, "resources", {
        "select": "id,title,level,board,subject,video_url,"
                  "resource_spec_points(spec_points(id,code,title,description,sort_order,topic_id,"
                  "topics(title,sort_order,subject,level,board)))",
        "kind": "eq.video"})
    by_id: dict[str, list] = {}
    for v in videos:
        by_id.setdefault((v.get("video_url") or "").rsplit("v=", 1)[-1], []).append(v)
    ids = [i for i in by_id if i]
    print(f"{len(videos)} video rows, {len(ids)} distinct videos")

    def check(i):
        return i, ytsearch.oembed(i)[0]

    with ThreadPoolExecutor(max_workers=12) as ex:
        first = dict(ex.map(check, ids))
    fails = [i for i, s in first.items() if s != 200]
    time.sleep(5)
    with ThreadPoolExecutor(max_workers=4) as ex:
        second = dict(ex.map(check, fails))
    dead = [i for i in fails if second[i] != 200]
    print(f"first pass {len(fails)} failed; {len(dead)} still fail on a second check")

    os.makedirs(OUT, exist_ok=True)
    dead_map: dict[str, list] = {}
    points: dict[str, dict] = {}
    with open(os.path.join(OUT, "dead-videos.tsv"), "w", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["status", "video_id", "level", "board", "subject", "point_code", "point_title", "video_title"])
        for i in dead:
            for v in by_id[i]:
                links = [l["spec_points"] for l in v.get("resource_spec_points") or [] if l.get("spec_points")]
                if not links:
                    w.writerow([second[i], i, v["level"], v["board"], v["subject"], "(unlinked)", "", v["title"][:70]])
                for sp in links:
                    w.writerow([second[i], i, v["level"], v["board"], v["subject"], sp["code"], sp["title"][:70], v["title"][:70]])
                    dead_map.setdefault(sp["id"], []).append(v["id"])
                    t = sp["topics"]
                    points[sp["id"]] = {
                        "id": sp["id"], "code": sp["code"], "title": sp["title"],
                        "description": sp.get("description") or "", "sort_order": sp["sort_order"],
                        "topic_id": sp["topic_id"], "topic": t["title"], "topic_order": t["sort_order"],
                        "subject": t["subject"], "level": t["level"], "board": t["board"],
                        "syllabus": SYLLABUS.get((t["level"], t["board"], t["subject"]), ""),
                    }
    print(f"{len(dead)} dead videos on {len(dead_map)} spec points -> out/dead-videos.tsv")
    if not args.export:
        return

    path = os.path.join(OUT, "points.json")
    queued = json.load(open(path)) if os.path.exists(path) else []
    have = {p["id"] for p in queued}
    queued += [p for k, p in points.items() if k not in have]
    queued.sort(key=lambda p: (p["level"], p["board"], p["subject"], p["topic_order"] or 0, p["sort_order"] or 0))
    json.dump(queued, open(path, "w"), indent=1)
    json.dump(dead_map, open(os.path.join(OUT, "dead_map.json"), "w"), indent=1)
    print(f"out/points.json now {len(queued)} points; out/dead_map.json written")


if __name__ == "__main__":
    main()
