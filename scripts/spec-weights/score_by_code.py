"""Size spec points for boards whose statements match our codes one-for-one.

OCR J247 and Edexcel International GCSE 4BI1 both number every learning outcome
(`B1.1a`, `2.14B`), and our tree uses the same numbering — so unlike AQA there is
nothing to align. Each statement is found by its code and scored directly.

    python3 scripts/spec-weights/score_by_code.py --board ocr \
        --pdf "~/Downloads/OCR biology spec.pdf" \
        --points scripts/spec-weights/out/ocr-gcse-biology-points.json

    python3 scripts/spec-weights/score_by_code.py --board igcse \
        --pdf ~/Downloads/international-gcse-biology-2017-specification1.pdf \
        --points scripts/spec-weights/out/edexcel-igcse-biology-points.json

See README.md for what a weight is and how to review the output.
"""

import argparse
import csv
import json
import os
import re

# --------------------------------------------------------------- board setup

BOARDS = {
    "ocr": {
        # B1.1a, B6.3aa … statements run to the start of the next one.  is
        # OCR's "separate science only" glyph, which sits between the code and
        # the text on 35 statements; it is a scope marker, not a difficulty one,
        # so it is skipped rather than scored. Higher tier is marked by BOLD
        # TYPE, which plain-text extraction cannot see — see README.
        "statement": r"\b(B[1-7]\.\d+[a-z]+)\s*?\s*(?=[A-Za-z])",
        "db_prefix": "OCR ",
        "db_to_spec": lambda code: "B" + code.replace("OCR ", ""),
        # Editorial furniture that sits between topic tables. Without cutting it
        # the last statement of every topic absorbs the whole teacher-guidance
        # block — the same trap the AQA parser hit with its practicals appendix.
        "stop": r"Common misconceptions|Tiering\b|Reference Mathematical|Prior knowledge|"
                r"Version \d|© OCR|Topic content Opportunities",
        "out": "ocr-gcse-biology",
    },
    "igcse": {
        # 1.1, 2.14B, 5.20B …
        "statement": r"\b(\d\.\d{1,3}B?)\s+(?=[a-z])",
        "db_prefix": "IGCSE ",
        "db_to_spec": lambda code: code.replace("IGCSE ", ""),
        "stop": r"Pearson Edexcel International GCSE|Specification – Issue|© Pearson Education",
        "out": "edexcel-igcse-biology",
    },
}

# ----------------------------------------------------------------- scoring

#: Roughly Bloom order, covering the command words both boards actually use.
VERB = {
    "state": 1.0, "name": 1.0, "know": 1.05, "recall": 1.1, "recognise": 1.1,
    "identify": 1.2, "list": 1.1, "describe": 1.3, "demonstrate": 1.4,
    "understand": 1.4, "draw": 1.5, "label": 1.3, "measure": 1.5, "use": 1.5,
    "estimate": 1.6, "interpret": 1.6, "plot": 1.6, "apply": 1.7,
    "explain": 1.7, "calculate": 1.8, "compare": 1.8, "predict": 1.9,
    "discuss": 1.9, "analyse": 2.0, "evaluate": 2.1, "investigate": 2.2,
    "practical": 2.4,
}

PRACTICAL = 2.0
PER_BULLET = 0.22
PER_MATHS_TAG = 0.25
MATHS_TAG_CAP = 4
VOLUME_CAP = 1.6
VOLUME_FREE_WORDS = 25          # statements are one sentence, not a table cell
VOLUME_WORDS_PER_UNIT = 45

#: A practical activity group. Our OCR tree carries nine of these as points of
#: their own (OCR 7.1–7.9); they are whole lab sessions, not learning outcomes,
#: so they get a flat practical-sized weight rather than a parsed one.
PAG_WEIGHT = 3.5


def score_statement(text):
    """One spec statement, in study units."""
    low = text.lower()

    first = re.match(r"\s*([a-z]+)", low)
    weight = VERB.get(first.group(1) if first else "", 1.4)

    # A statement that IS a practical, however it is phrased.
    if re.match(r"\s*practical\b", low) or "investigate" in low.split(":")[0][:60]:
        weight += PRACTICAL

    weight += PER_BULLET * text.count("•")

    # Maths skill references: OCR tags M1b/M2a, Edexcel writes them into prose.
    weight += PER_MATHS_TAG * min(len(set(re.findall(r"\bM\d[a-z]\b", text))), MATHS_TAG_CAP)

    words = len(text.split())
    weight += min(VOLUME_CAP, max(0, words - VOLUME_FREE_WORDS) / VOLUME_WORDS_PER_UNIT)

    return round(weight, 2)


# --------------------------------------------------------------- extraction


def statements(pdf_path, cfg):
    """Every numbered statement in the spec, code -> text."""
    import pypdf

    text = "\n".join(p.extract_text() or "" for p in pypdf.PdfReader(pdf_path).pages)
    hits = list(re.finditer(cfg["statement"], text))
    out = {}
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else min(len(text), m.end() + 1200)
        body = text[m.end() : end]
        stop = re.search(cfg["stop"], body)
        if stop:
            body = body[: stop.start()]
        body = " ".join(body.split())
        # Keep the longest sighting: codes recur in contents lists and appendices.
        if len(body) > len(out.get(m.group(1), "")):
            out[m.group(1)] = body
    return out


# --------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--board", required=True, choices=sorted(BOARDS))
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--points", required=True)
    ap.add_argument("--out")
    args = ap.parse_args()

    cfg = BOARDS[args.board]
    out_base = args.out or f"scripts/spec-weights/out/{cfg['out']}"

    spec = statements(os.path.expanduser(args.pdf), cfg)
    points = json.load(open(args.points))

    rows, matched, pags, missing = [], 0, 0, []
    for code, title in points:
        key = cfg["db_to_spec"](code)
        if key in spec:
            weight, source = score_statement(spec[key]), key
            matched += 1
            # Reviewing a weight means reading the statement it came from, so fall
            # back to the spec's own wording where our tree has no title.
            title = title or spec[key][:90]
        elif args.board == "ocr" and re.match(r"OCR 7\.\d", code):
            weight, source = PAG_WEIGHT, "practical activity group"
            pags += 1
        else:
            weight, source = None, "NOT FOUND"
            missing.append(code)
        rows.append((code, title, weight, source))

    with open(out_base + ".csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["code", "title", "weight", "source"])
        w.writerows(rows)
    with open(out_base + ".json", "w") as fh:
        json.dump({c: {"title": t, "weight": wt, "source": s} for c, t, wt, s in rows}, fh, indent=1)

    got = [r[2] for r in rows if r[2] is not None]
    print(f"{len(spec)} statements parsed | {len(points)} points: {matched} matched by code, "
          f"{pags} practical groups, {len(missing)} unmatched")
    if missing:
        print("  unmatched:", ", ".join(missing[:12]) + (" …" if len(missing) > 12 else ""))
    print(f"weights min {min(got)} max {max(got)} total {sum(got):.1f}  ->  {out_base}.csv")


if __name__ == "__main__":
    main()
