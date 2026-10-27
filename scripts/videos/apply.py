from __future__ import annotations
"""
Write the chosen videos into Anglian: one video row per spec point.

    set -a && . ./.env && set +a && python3 scripts/videos/apply.py            # preview
    set -a && . ./.env && set +a && python3 scripts/videos/apply.py --write    # write

A spec point's video renders only through resource_spec_points, and the
planner's coverage flag reads resources.spec_point_id, so each point gets both:
a `resources` row (kind video, the seeded-curriculum owner 1111…, origin tutor,
approved) and its join row. Same shape as every other curriculum video.

Before anything is written:
  - every chosen video is re-checked over oEmbed; only HTTP 200 is written;
  - points that gained a video since the export are skipped;
  - the row ids are generated here and saved to out/manifest-<time>.json, so
    the undo is exact: delete from resources where id in (the manifest)
    (resource_spec_points rows go with them, ON DELETE CASCADE).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ytsearch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
OWNER = "11111111-1111-1111-1111-111111111111"


def api(url, key, method, path, body=None, prefer="return=minimal"):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": prefer},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} failed: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:400]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    final = []
    for name in ("final.json", "final2.json"):
        path = os.path.join(OUT, name)
        if os.path.exists(path):
            final += json.load(open(path))
    assert len({r["spec_point_id"] for r in final}) == len(final), "a point is in both rounds"

    # Points that already have a video now (another run, a tutor's edit).
    have = set()
    ids = [r["spec_point_id"] for r in final]
    for i in range(0, len(ids), 100):
        q = urllib.parse.urlencode({
            "select": "spec_point_id,resources!inner(kind)",
            "resources.kind": "eq.video",
            "spec_point_id": "in.({})".format(",".join(ids[i:i + 100])),
        })
        have |= {l["spec_point_id"] for l in api(url, key, "GET", f"resource_spec_points?{q}", prefer="")}

    # oEmbed again, right before writing: live and embeddable, nothing else.
    status = {}
    for vid in dict.fromkeys(r["video_id"] for r in final):
        status[vid] = ytsearch.oembed(vid)
    rows, links, skipped, dead = [], [], 0, []
    for r in final:
        if r["spec_point_id"] in have:
            skipped += 1
            continue
        code, title, channel = status[r["video_id"]]
        if code != 200:
            dead.append((r["code"], r["video_id"], code))
            continue
        rid = str(uuid.uuid4())
        rows.append({
            "id": rid, "kind": "video",
            "title": title or r["video_title"],
            "description": channel or r["channel"],
            "subject": r["subject"], "board": r["board"], "level": r["level"],
            "video_url": r["url"], "duration_seconds": r.get("duration"),
            "created_by": OWNER, "spec_point_id": r["spec_point_id"],
            "origin": "tutor", "review_status": "approved",
        })
        links.append({"resource_id": rid, "spec_point_id": r["spec_point_id"]})

    print(f"{len(rows)} video rows to write ({len({x['video_url'] for x in rows})} distinct videos); "
          f"{skipped} points already have a video; {len(dead)} picks no longer embed")
    for d in dead[:20]:
        print(f"  not embeddable now: {d}")
    if not args.write:
        print("Preview only. Re-run with --write to load.")
        return

    manifest = os.path.join(OUT, f"manifest-{time.strftime('%Y%m%dT%H%M%S')}.json")
    with open(manifest, "w") as f:
        json.dump({"resources": [x["id"] for x in rows], "rows": rows}, f, indent=1)
    print(f"manifest: {manifest}")
    for i in range(0, len(rows), 200):
        api(url, key, "POST", "resources", rows[i:i + 200])
        api(url, key, "POST", "resource_spec_points", links[i:i + 200])
        print(f"  {min(i + 200, len(rows))}/{len(rows)}", flush=True)
    print("written")


if __name__ == "__main__":
    main()
