from __future__ import annotations
"""
Swap a checked replacement into each dead video row, in place.

    set -a && . ./.env && set +a && python3 scripts/videos/replace_dead.py            # preview
    set -a && . ./.env && set +a && python3 scripts/videos/replace_dead.py --write    # write

Reads out/dead_map.json (from dead.py --export) and the reviewed picks
(out/final.json and final2.json by default; --final to name others). For each
dead spec point with a pick: oEmbed again (only 200 is written), then PATCH that
same `resources` row's video_url, title (the real YouTube title), description
(the channel) and duration. The row keeps its id, so nothing that points at it
breaks. apply.py skips these points, because they already have a video row.

Before writing, the old values are saved to out/dead-undo-<time>.json. Copy it
to papers/backups/. The undo is to PATCH each row back to its saved values.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ytsearch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")


def api(url, key, method, path, body=None):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=representation"},
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
    ap.add_argument("--final", action="append", help="pick files in out/ (default: final.json final2.json)")
    args = ap.parse_args()
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    dead_map = json.load(open(os.path.join(OUT, "dead_map.json")))
    final = []
    for name in args.final or ("final.json", "final2.json"):
        path = os.path.join(OUT, name)
        if os.path.exists(path):
            final += json.load(open(path))
    pick = {r["spec_point_id"]: r for r in final if r["spec_point_id"] in dead_map}
    ids = [rid for sp in pick for rid in dead_map[sp]]
    old = {}
    for i in range(0, len(ids), 100):
        q = urllib.parse.urlencode({"select": "id,video_url,title,description,duration_seconds",
                                    "id": "in.({})".format(",".join(ids[i:i + 100]))})
        old |= {r["id"]: r for r in api(url, key, "GET", f"resources?{q}")}

    plan, dead = [], []
    for sp, r in pick.items():
        code, title, channel = ytsearch.oembed(r["video_id"])
        if code != 200:
            dead.append((r["code"], r["video_id"], code))
            continue
        for rid in dead_map[sp]:
            o = old[rid]
            if f"v={r['video_id']}" in (o["video_url"] or ""):
                continue  # already swapped
            plan.append((rid, r["code"], o, {
                "video_url": r["url"], "title": title or r["video_title"],
                "description": channel or r["channel"], "duration_seconds": r.get("duration"),
            }))
    missing = [sp for sp in dead_map if sp not in pick]
    print(f"{len(plan)} dead rows to swap; {len(dead)} picks no longer embed; "
          f"{len(missing)} dead points have no pick (they keep the dead link)")
    for rid, code, o, n in plan:
        print(f"  {code:16} {o['title'][:45]!r:48} -> {n['title'][:50]!r}")
    if not args.write:
        print("Preview only. Re-run with --write to swap.")
        return

    undo = os.path.join(OUT, f"dead-undo-{time.strftime('%Y%m%dT%H%M%S')}.json")
    with open(undo, "w") as f:
        json.dump([o for _, _, o, _ in plan], f, indent=1)
    print(f"undo file: {undo}")
    for rid, code, o, n in plan:
        got = api(url, key, "PATCH", f"resources?id=eq.{rid}&kind=eq.video", n)
        if not got or len(got) != 1:
            raise SystemExit(f"{code}: PATCH of {rid} changed {len(got or [])} rows")
    print(f"swapped {len(plan)}")


if __name__ == "__main__":
    main()
