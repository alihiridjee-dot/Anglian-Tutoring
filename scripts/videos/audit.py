from __future__ import annotations
"""
Re-check what is actually in the database, live.

    set -a && . ./.env && set +a && python3 scripts/videos/audit.py [--level igcse] [--sample 0]

Per course: how many spec points have a video row joined through
resource_spec_points (the only way the site shows one), then oEmbed on the
distinct videos (a sample, or every one with --sample 0). The point is to catch
the failure this library had once already: rows that look populated but hold a
dead or non-embeddable id.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ytsearch


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
    ap.add_argument("--level", default="igcse")
    ap.add_argument("--sample", type=int, default=300, help="0 = check every distinct video")
    args = ap.parse_args()
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    topics = get_all(url, key, "topics", {"select": "id,board,subject", "level": f"eq.{args.level}"})
    course = {t["id"]: f"{t['board']} {args.level} {t['subject']}" for t in topics}
    points = []
    ids = list(course)
    for i in range(0, len(ids), 40):
        points += get_all(url, key, "spec_points", {
            "select": "id,topic_id", "topic_id": "in.({})".format(",".join(ids[i:i + 40]))})
    videos = get_all(url, key, "resources", {
        "select": "video_url,resource_spec_points(spec_point_id)",
        "kind": "eq.video", "level": f"eq.{args.level}"})
    covered = {l["spec_point_id"] for v in videos for l in v.get("resource_spec_points") or []}

    total, have = Counter(), Counter()
    for p in points:
        k = course[p["topic_id"]]
        total[k] += 1
        have[k] += p["id"] in covered
    for k in sorted(total):
        print(f"  {k:32} {have[k]:4}/{total[k]:<4} points have a video")

    vids = list(dict.fromkeys(
        v["video_url"].rsplit("v=", 1)[-1] for v in videos if "v=" in (v.get("video_url") or "")))
    check = vids if args.sample == 0 else vids[:: max(1, len(vids) // max(args.sample, 1))]
    print(f"\nre-checking {len(check)} of {len(vids)} distinct videos over oEmbed…")
    stats, bad = Counter(), []

    def one(v):
        status, _, _ = ytsearch.oembed(v)
        stats[status] += 1
        if status != 200:
            bad.append((v, status))

    with ThreadPoolExecutor(max_workers=12) as ex:
        list(ex.map(one, check))
    print("  " + ", ".join(f"HTTP {k}: {v}" for k, v in sorted(stats.items())))
    if bad:
        print("  bad ids: " + ", ".join(f"{v}({s})" for v, s in bad[:30]))


if __name__ == "__main__":
    main()
