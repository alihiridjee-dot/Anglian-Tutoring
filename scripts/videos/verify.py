from __future__ import annotations
"""
oEmbed-check candidate video ids and cache the verdict.

    python3 scripts/videos/verify.py            (called by match.py; safe alone)

Two failure modes matter and only one is obvious:
  404  the id does not exist
  401/403  the uploader DISABLED EMBEDDING — the video plays fine on
           youtube.com and renders "Video unavailable" inside our iframe
Only 200 is acceptable. oEmbed also returns the video's REAL title and channel,
which is the check that catches a live link pointing at the wrong topic.
"""
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ytsearch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
STORE = os.path.join(OUT, "verified.json")

_lock = threading.Lock()
_cache = None


def load() -> dict:
    global _cache
    if _cache is None:
        _cache = json.load(open(STORE)) if os.path.exists(STORE) else {}
    return _cache


def save() -> None:
    with _lock:
        tmp = STORE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(load(), f)
        os.replace(tmp, STORE)


def check_many(ids, workers: int = 12) -> dict:
    c = load()
    todo = [v for v in dict.fromkeys(ids) if v not in c]
    if not todo:
        return c
    done = [0]

    def one(vid):
        status, title, channel = ytsearch.oembed(vid)
        with _lock:
            c[vid] = {"status": status, "title": title, "channel": channel}
            done[0] += 1
            if done[0] % 100 == 0:
                print(f"    verified {done[0]}/{len(todo)}", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(one, todo))
    save()
    return c


def ok(vid: str) -> bool:
    return load().get(vid, {}).get("status") == 200


if __name__ == "__main__":
    ids = [line.strip() for line in sys.stdin if line.strip()]
    c = check_many(ids)
    good = sum(1 for v in ids if c.get(v, {}).get("status") == 200)
    print(f"{good}/{len(ids)} embeddable")
