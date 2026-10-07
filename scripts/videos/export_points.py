from __future__ import annotations
"""
Dump the spec points that have no video to out/points.json.

    set -a && . ./.env && set +a && python3 scripts/videos/export_points.py

Targets: Cambridge IGCSE Biology/Chemistry/Physics and Edexcel IGCSE Physics.
A point that already has a video row (through resource_spec_points) is skipped,
so a re-run only picks up what is still missing.
"""
import json
import os
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

TARGETS = [
    ("igcse", "cambridge", "biology", "0610"),
    ("igcse", "cambridge", "chemistry", "0620"),
    ("igcse", "cambridge", "physics", "0625"),
    ("igcse", "edexcel", "physics", "4PH1"),
]


def get(url: str, key: str, path: str, params: dict) -> list:
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({**params, "limit": 1000, "offset": offset})
        req = urllib.request.Request(
            f"{url}/rest/v1/{path}?{q}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.loads(r.read().decode("utf-8"))
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        offset += len(batch)


def main() -> None:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    points = []
    for level, board, subject, syllabus in TARGETS:
        topics = get(url, key, "topics", {
            "select": "id,title,sort_order",
            "level": f"eq.{level}", "board": f"eq.{board}", "subject": f"eq.{subject}",
        })
        tmap = {t["id"]: t for t in topics}
        ids = list(tmap)
        sps = []
        for i in range(0, len(ids), 40):
            sps += get(url, key, "spec_points", {
                "select": "id,code,title,description,sort_order,topic_id",
                "topic_id": "in.({})".format(",".join(ids[i:i + 40])),
            })
        # Points that already have a video row are not wanted.
        have = set()
        sp_ids = [s["id"] for s in sps]
        for i in range(0, len(sp_ids), 100):
            links = get(url, key, "resource_spec_points", {
                "select": "spec_point_id,resources!inner(kind)",
                "resources.kind": "eq.video",
                "spec_point_id": "in.({})".format(",".join(sp_ids[i:i + 100])),
            })
            have |= {l["spec_point_id"] for l in links}
        for s in sps:
            if s["id"] in have:
                continue
            t = tmap[s["topic_id"]]
            points.append({
                "id": s["id"],
                "code": s["code"],
                "title": s["title"],
                "description": s.get("description") or "",
                "sort_order": s["sort_order"],
                "topic_id": s["topic_id"],
                "topic": t["title"],
                "topic_order": t["sort_order"],
                "subject": subject,
                "level": level,
                "board": board,
                "syllabus": syllabus,
            })
        print(f"{board} {level} {subject}: {len(sps)} points, {len(have)} already have a video")
    points.sort(key=lambda p: (p["board"], p["subject"], p["topic_order"] or 0, p["sort_order"] or 0))
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "points.json"), "w") as f:
        json.dump(points, f, indent=1)
    print(f"wrote {len(points)} spec points")


if __name__ == "__main__":
    main()
