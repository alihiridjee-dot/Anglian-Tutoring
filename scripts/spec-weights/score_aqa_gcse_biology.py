"""Size every AQA GCSE Biology (8461) spec point, offline.

Why this exists: the planner sizes a topic's band and slices it into weeks by
COUNTING spec points, which assumes they're all the same size. They aren't —
across a real spec the largest is several times the smallest, so a "three points
a week" slice can be twenty minutes or two hours. This produces a per-point
weight in study units so the planner can divide by workload instead.

Run once per spec, not per request. Output is reviewed by a tutor and then
loaded into spec_points.weight.

    python3 scripts/spec-weights/score_aqa_gcse_biology.py \
        --pdf ~/Downloads/AQA-8461-SP-2016.PDF \
        --points scripts/spec-weights/out/aqa-gcse-biology-points.json

`--points` is the tree as it exists in the database — `[["AQA 1.1", "title"], …]`
in spec order — which you can dump with:

    select json_agg(json_build_array(sp.code, sp.title) order by t.sort_order, sp.sort_order)
    from topics t join spec_points sp on sp.topic_id = t.id
    where t.subject='biology' and t.board='aqa' and t.level='gcse';
"""

import argparse
import csv
import json
import re
from difflib import SequenceMatcher

# --------------------------------------------------------------- extraction


def leaf_sections(pdf_path):
    """Every assessable leaf section of the spec, with its full content text.

    AQA nests content as 4.<topic>.<group>.<section>, but a few groups (4.2.1
    Principles of organisation, 4.5.1 Homeostasis, 4.6.4 Classification) hold
    content directly with no fourth level. Both are leaves; a group that has
    children is only a heading and must not be scored, or its content would be
    counted twice.
    """
    import pypdf

    pages = [p.extract_text() or "" for p in pypdf.PdfReader(pdf_path).pages]
    start = next(i for i, p in enumerate(pages) if re.search(r"^\s*4\.1\.1\.1", p, re.M))
    body = "\n".join(pages[start:])
    body = "\n".join(
        l
        for l in body.split("\n")
        if not re.search(r"Visit aqa\.org\.uk|GCSE Biology \(8461\)\. For exams|^\s*\d{1,3}\s*$", l)
    )
    # Stop at the end of the taught content. "4.8 Key ideas" is the first thing
    # after the last content section; everything past it (key ideas, scheme of
    # assessment, and crucially the appendix that RE-LISTS all ten required
    # practicals) would otherwise be absorbed by the final section, which scored
    # 4.7.5.4 as though it contained every practical in the course.
    end = re.search(r"\n\s*4\.8\s+Key ideas|\n\s*5\s+Scheme of assessment", body)
    if not end:
        raise SystemExit("could not find the end of the content section — check the PDF version")
    body = body[: end.start()]

    parts = re.split(r"\n(?=\s*(4\.\d+\.\d+(?:\.\d+)?)\s+[A-Z])", "\n" + body)
    raw = [(parts[i], parts[i + 1]) for i in range(1, len(parts) - 1, 2)]

    out, seen = [], set()
    for idx, (code, blk) in enumerate(raw):
        text = " ".join(blk.split())
        if code.count(".") == 2:  # 4.x.y — a leaf only if nothing nests under it
            nxt = raw[idx + 1][0] if idx + 1 < len(raw) else ""
            if nxt.startswith(code + ".") or "Content" not in text:
                continue
        if code in seen:
            continue
        seen.add(code)
        title = re.sub(r"^" + re.escape(code) + r"\s*", "", blk.strip().split("\n")[0]).strip()
        out.append({"code": code, "title": title, "text": text})
    return out


# ----------------------------------------------------------------- scoring

#: Roughly Bloom order — what the spec asks the student to *do* with the content
#: is the best single predictor of how long it takes to teach and to learn.
VERB = {
    "state": 1.0, "name": 1.0, "recall": 1.1, "recognise": 1.1, "identify": 1.2,
    "describe": 1.3, "demonstrate": 1.4, "understand": 1.4, "draw": 1.5,
    "measure": 1.5, "use": 1.5, "estimate": 1.6, "extract": 1.6,
    "interpret": 1.6, "plot": 1.6, "apply": 1.7, "explain": 1.7,
    "calculate": 1.8, "compare": 1.8, "translate": 1.8, "discuss": 1.9,
    "predict": 1.9, "analyse": 2.0, "evaluate": 2.1,
}

REQUIRED_PRACTICAL = 2.0  # a practical is its own lesson, whatever else is in the section
PER_EXTRA_ASK = 0.35      # each additional "students should be able to…"
PER_BULLET = 0.22         # each enumerated thing to learn
HT_ONLY = 0.3
VOLUME_CAP = 1.6          # residual content mass, capped so one wordy section can't dominate
VOLUME_FREE_WORDS = 110
VOLUME_WORDS_PER_UNIT = 130


def score_section(sec):
    """One AQA leaf section, in study units."""
    text, low = sec["text"], sec["text"].lower()

    asks = re.findall(r"students should be able to\s+(?:,?\s*)?([a-z]+)", low)
    scores = [VERB.get(v, 1.5) for v in asks]
    weight = max(scores) if scores else 1.3  # content with no explicit ask ≈ "describe"
    weight += PER_EXTRA_ASK * max(0, len(scores) - 1)

    weight += PER_BULLET * text.count("•")

    if "required practical activity" in low:
        weight += REQUIRED_PRACTICAL

    # Maths and apparatus skill tags: numeracy needs practice, not just exposition.
    weight += 0.25 * min(len(set(re.findall(r"\bMS\s*\d+[a-z]?", text))), 4)
    weight += 0.15 * min(len(set(re.findall(r"\bAT\s*\d+", text))), 3)

    if "(ht only)" in low:
        weight += HT_ONLY

    words = len(text.split())
    weight += min(VOLUME_CAP, max(0, words - VOLUME_FREE_WORDS) / VOLUME_WORDS_PER_UNIT)

    return round(weight, 2)


# --------------------------------------------------------------- alignment

STOP = set("and the of a in to for on with its their from as by".split())


def _norm(s):
    s = re.sub(r"\((?:biology only|ht)[^)]*\)", "", s, flags=re.I)
    return [w for w in re.findall(r"[a-z]+", s.lower()) if w not in STOP]


def similarity(a, b):
    A, B = set(_norm(a)), set(_norm(b))
    jaccard = len(A & B) / max(1, len(A | B))
    ratio = SequenceMatcher(None, " ".join(_norm(a)), " ".join(_norm(b))).ratio()
    return 0.6 * jaccard + 0.4 * ratio


#: Cost of making any link at all. Without it the search just maximises the
#: number of links — every point ends up smeared across its neighbours — because
#: every similarity is positive. At 0.45 a link has to be a better-than-chance
#: title match to be worth taking.
LINK_PENALTY = 0.45


def align(points, sections, penalty=LINK_PENALTY):
    """Monotonic many-to-many alignment; returns (point_idx, section_idx) links.

    Both lists are in spec order, so this is a path through the grid: diagonal is
    a clean 1:1, sideways merges an extra section into one point, downward splits
    one section across consecutive points. The tree does both — it merges AQA's
    four separate pathogen sections into one point, and splits AQA's single
    digestive-system section into four.
    """
    n, m = len(points), len(sections)
    NEG = float("-inf")
    dp = [[NEG] * m for _ in range(n)]
    back = [[None] * m for _ in range(n)]
    for i in range(n):
        for j in range(m):
            gain = similarity(points[i][1], sections[j]["title"]) - penalty
            best, arg = (0.0, None) if (i == 0 and j == 0) else (NEG, None)
            for pi, pj in ((i - 1, j - 1), (i, j - 1), (i - 1, j)):
                if pi >= 0 and pj >= 0 and dp[pi][pj] > best:
                    best, arg = dp[pi][pj], (pi, pj)
            if best == NEG:
                continue
            dp[i][j], back[i][j] = best + gain, arg
    path, cur = [], (n - 1, m - 1)
    while cur:
        path.append(cur)
        cur = back[cur[0]][cur[1]]
    return path[::-1]


def weigh(points, sections):
    """Per-point weights. A section split across k points contributes 1/k to each,
    so a topic's total is conserved however the boundaries fall."""
    by_topic_pts, by_topic_secs = {}, {}
    for code, title in points:
        by_topic_pts.setdefault(int(code.split()[1].split(".")[0]), []).append((code, title))
    for s in sections:
        by_topic_secs.setdefault(int(s["code"].split(".")[1]), []).append(s)

    out = {}
    for topic in sorted(by_topic_pts):
        P, S = by_topic_pts[topic], by_topic_secs[topic]
        links = align(P, S)
        shared = {}
        for _, j in links:
            shared[j] = shared.get(j, 0) + 1
        for i, j in links:
            code = P[i][0]
            row = out.setdefault(code, {"title": P[i][1], "sections": [], "weight": 0.0})
            row["sections"].append(S[j]["code"] + ("" if shared[j] == 1 else f" (1/{shared[j]})"))
            row["weight"] += S[j]["score"] / shared[j]
    for row in out.values():
        row["weight"] = round(row["weight"], 2)
    return out


# --------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--points", required=True)
    ap.add_argument("--out", default="scripts/spec-weights/out/aqa-gcse-biology")
    args = ap.parse_args()

    sections = leaf_sections(args.pdf)
    for s in sections:
        s["score"] = score_section(s)
    points = json.load(open(args.points))
    weights = weigh(points, sections)

    with open(args.out + ".json", "w") as fh:
        json.dump(weights, fh, indent=1)
    with open(args.out + ".csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["code", "title", "weight", "aqa_sections"])
        for code, row in weights.items():
            w.writerow([code, row["title"], row["weight"], "; ".join(row["sections"])])

    total = sum(r["weight"] for r in weights.values())
    exact = sum(
        1 for r in weights.values() if len(r["sections"]) == 1 and "/" not in r["sections"][0]
    )
    print(f"{len(sections)} spec sections -> {len(weights)} points")
    print(f"{exact} matched a single section cleanly; {len(weights) - exact} merged or split")
    print(f"total {total:.1f} units  ->  {args.out}.csv")


if __name__ == "__main__":
    main()
