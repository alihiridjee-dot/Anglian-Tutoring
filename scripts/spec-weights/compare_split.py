"""What weighting does to the week-by-week workload, on the real calendar.

The programme runs from the first Monday of September to the exam, in ONE year:
37 weeks, of which the last `REVISION_WEEKS` are a revision run, leaving 34 for
teaching. Reports the current algorithm (count topics, cut by equal counts, round
up) against the weighted one (allocate by weight, cut by min-max partition).
"""

import csv
import glob
import json
import math
import os
import statistics as st
from datetime import date, timedelta

REVISION_WEEKS = 3


def programme_weeks(year, exam_month=5, exam_day=28):
    """Weeks from the first Monday of September to the average exam Monday.

    The exam anchor is the midpoint of the summer series for GCSE sciences —
    papers straddle mid-May to mid-June — NOT the first paper. Teaching plus
    revision has to be finished before then.
    """
    sep1 = date(year, 9, 1)
    start = sep1 + timedelta(days=(7 - sep1.weekday()) % 7)
    exam = date(year + 1, exam_month, exam_day)
    exam_monday = exam - timedelta(days=exam.weekday())
    return round((exam_monday - start).days / 7)


def allocate(sizes, weeks):
    """Largest-remainder share-out of whole weeks, at least one each."""
    n = len(sizes)
    budget = max(weeks, n)
    total = sum(sizes)
    exact = [s / total * budget for s in sizes]
    base = [max(1, math.floor(x)) for x in exact]
    remaining = budget - sum(base)
    order = sorted(range(n), key=lambda i: -(exact[i] - math.floor(exact[i])))
    k = 0
    while remaining > 0:
        base[order[k % n]] += 1
        remaining -= 1
        k += 1
    return base


def split_ceil(points, weeks):
    """Today's splitAcrossWeeks: equal counts, rounded up — so the tail starves."""
    weeks = max(1, weeks)
    per = max(1, math.ceil(len(points) / weeks))
    return [points[i * per : (i + 1) * per] for i in range(weeks)]


def split_partition(points, weeks, weight):
    """Exact min-max contiguous partition — the heaviest week made as light as possible."""
    weeks = max(1, weeks)
    w = [weight[p] for p in points]
    n = len(w)
    if weeks >= n:
        sizes = [1] * n + [0] * (weeks - n)
    else:
        pre = [0.0] * (n + 1)
        for i, x in enumerate(w):
            pre[i + 1] = pre[i] + x
        INF = float("inf")
        M = [[INF] * (weeks + 1) for _ in range(n + 1)]
        D = [[0] * (weeks + 1) for _ in range(n + 1)]
        for i in range(1, n + 1):
            M[i][1] = pre[i]
        for j in range(1, weeks + 1):
            M[0][j] = 0.0
        for i in range(1, n + 1):
            for j in range(2, weeks + 1):
                for x in range(1, i):
                    cost = max(M[x][j - 1], pre[i] - pre[x])
                    if cost < M[i][j]:
                        M[i][j], D[i][j] = cost, x
        sizes, i, j = [], n, weeks
        while j > 1:
            x = D[i][j]
            sizes.append(i - x)
            i, j = x, j - 1
        sizes.append(i)
        sizes.reverse()
    out, i = [], 0
    for s in sizes:
        out.append(points[i : i + s])
        i += s
    return out


def topic_of(code):
    """Leading topic number, for every board's code style."""
    body = code.split(" ", 1)[1] if " " in code else code
    return body.split(".")[0]


def evaluate(path, teaching_weeks):
    rows = [r for r in csv.DictReader(open(path)) if r["weight"]]
    weight = {r["code"]: float(r["weight"]) for r in rows}
    topics = {}
    for r in rows:
        topics.setdefault(topic_of(r["code"]), []).append(r["code"])
    groups = [topics[k] for k in sorted(topics, key=lambda x: int(x))]

    def run(sizes, splitter):
        weeks = allocate(sizes, teaching_weeks)
        load, counts = [], []
        for pts, w in zip(groups, weeks):
            for chunk in splitter(pts, w):
                load.append(sum(weight[p] for p in chunk))
                counts.append(len(chunk))
        return load, counts

    cur, cur_n = run([len(g) for g in groups], split_ceil)
    new, new_n = run(
        [sum(weight[p] for p in g) for g in groups],
        lambda p, w: split_partition(p, w, weight),
    )
    return (weight, cur, cur_n, new, new_n)


def line(label, load, counts):
    live = [x for x in load if x > 0] or [0]
    return (f"  {label:26} lightest {min(live):5.1f}  heaviest {max(load):5.1f}  "
            f"spread {max(load) / min(live):5.1f}x  sd {st.pstdev(load):4.1f}  "
            f"empty {sum(1 for c in counts if c == 0)}")


def main():
    weeks = programme_weeks(date.today().year)
    teaching = weeks - REVISION_WEEKS
    print(f"Programme: first Monday of September -> average exam period")
    print(f"{weeks} weeks, minus {REVISION_WEEKS} revision = {teaching} teaching weeks\n")

    here = os.path.dirname(os.path.abspath(__file__))
    for path in sorted(glob.glob(os.path.join(here, "out", "*.csv"))):
        name = os.path.basename(path).replace(".csv", "")
        weight, cur, cur_n, new, new_n = evaluate(path, teaching)
        vals = list(weight.values())
        print(f"{name}  ({len(vals)} points, weights {min(vals)}–{max(vals)}, "
              f"median {st.median(vals):.2f}, total {sum(vals):.0f})")
        print(line("current (count + ceil)", cur, cur_n))
        print(line("weighted (partition)", new, new_n))
        print()


if __name__ == "__main__":
    main()
