from __future__ import annotations
"""
Run every spec point's search query and cache the results.

    set -a && . ./.env && set +a && python3 scripts/videos/harvest.py [--limit N] [--workers N]

One JSON file per query under out/cache/, so a re-run costs nothing for queries
already fetched and the job can be stopped and resumed. An EMPTY result is
cached as a miss marker rather than an empty list, because empty means either
"no such video" or "YouTube throttled us" and those must not be conflated.
"""
import argparse
import hashlib
import json
import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import queries as Q
import ytsearch

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
CACHE = os.path.join(OUT, "cache")

_lock = threading.Lock()
_done = 0


def cache_path(query: str) -> str:
    return os.path.join(CACHE, hashlib.sha1(query.encode()).hexdigest()[:16] + ".json")


def cached(query: str):
    p = cache_path(query)
    if not os.path.exists(p):
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except json.JSONDecodeError:
        return None


def fetch(query: str, total: int) -> None:
    global _done
    if cached(query) is None:
        time.sleep(random.uniform(0.05, 0.35))
        results = ytsearch.search(query, limit=18)
        rec = {"query": query, "results": results, "ok": bool(results), "at": time.time()}
        tmp = cache_path(query) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(rec, f)
        os.replace(tmp, cache_path(query))
    with _lock:
        _done += 1
        if _done % 25 == 0 or _done == total:
            print(f"  {_done}/{total}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--fallbacks", action="store_true", help="also fetch topic-level queries")
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    points = json.load(open(os.path.join(OUT, "points.json")))
    wanted = []
    seen = set()
    for p in points:
        qs = Q.build(p)
        for q in qs if args.fallbacks else qs[:1]:
            if q not in seen:
                seen.add(q)
                wanted.append(q)
    todo = [q for q in wanted if cached(q) is None]
    have = len(wanted) - len(todo)
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(wanted)} queries, {have} cached, fetching {len(todo)}")

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        list(ex.map(lambda q: fetch(q, len(todo)), todo))

    hits = sum(1 for q in wanted if (cached(q) or {}).get("ok"))
    print(f"done — {hits}/{len(wanted)} queries returned results")


if __name__ == "__main__":
    main()
