"""Edexcel GCSE spec: every content statement with the share of its letters set in bold.
Bold = Higher tier only ('text in bold indicates content that is for higher tier only')."""
import sys, re, json, pymupdf
CODE = re.compile(r"^\d{1,2}\.\d{1,2}[A-Z]?$")
FOOTER = re.compile(r"Pearson Edexcel|Specification – Issue|© Pearson|Issue \d")
def parse(path):
    doc = pymupdf.open(path)
    rows, seen = [], set()
    for pno in range(doc.page_count):
        page = doc[pno]; h = page.rect.height
        lines = []
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                spans = [s for s in l["spans"] if s["text"].strip()]
                if not spans: continue
                x0, y0, x1, y1 = l["bbox"]
                if y0 > h - 60 or y0 < 60: continue
                text = "".join(s["text"] for s in spans).strip()
                if FOOTER.search(text): continue
                m = re.match(r"^(\d{1,2}\.\d{1,2}[A-Z]?)(?:\s+(.*))?$", text, re.S) if x0 < 120 else None
                if m:
                    lines.append({"x0": x0, "y0": y0, "code": m.group(1), "spans": []})
                    first = spans[0]["text"].strip()
                    if CODE.match(first):
                        rest = spans[1:]                       # code in its own span
                    else:                                       # code and text share a span
                        rest = [{**spans[0], "text": spans[0]["text"].split(None, 1)[1] if len(spans[0]["text"].split(None, 1)) > 1 else ""}] + spans[1:]
                    rest = [s for s in rest if s["text"].strip()]
                    if rest: lines.append({"x0": 128, "y0": y0, "spans": rest})
                else:
                    lines.append({"x0": x0, "y0": y0, "spans": spans})
        codes = sorted([l for l in lines if "code" in l], key=lambda l: l["y0"])
        if not codes: continue
        for i, c in enumerate(codes):
            ytop = c["y0"] - 4
            ybot = codes[i + 1]["y0"] - 4 if i + 1 < len(codes) else 10_000
            body = [l for l in lines if "code" not in l and 120 <= l["x0"] < 420 and ytop <= l["y0"] < ybot]
            body.sort(key=lambda l: (l["y0"], l["x0"]))
            text, bold_letters, letters, frags, cur = [], 0, 0, [], []
            for l in body:
                for s in l["spans"]:
                    t = s["text"]; n = sum(ch.isalpha() for ch in t); b = "Bold" in s["font"]
                    letters += n
                    if b: bold_letters += n; cur.append(t)
                    elif n:
                        if cur: frags.append(" ".join("".join(cur).split())); cur = []
                    text.append(t)
                text.append(" ")
            if cur: frags.append(" ".join("".join(cur).split()))
            stmt = " ".join("".join(text).split())
            if not stmt or letters == 0 or c["code"] in seen: continue
            seen.add(c["code"])
            rows.append({"page": pno + 1, "code": c["code"], "statement": stmt,
                         "bold_share": round(bold_letters / letters, 3), "bold_fragments": [f for f in frags if f]})
    return rows
if __name__ == "__main__":
    rows = parse(sys.argv[1]); json.dump(rows, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
    full = [r for r in rows if r["bold_share"] >= 0.9]; part = [r for r in rows if 0.08 <= r["bold_share"] < 0.9]
    print(f"{len(rows)} statements; {len(full)} fully bold: {' '.join(r['code'] for r in full)}")
    for r in part: print("PART", r["code"], r["bold_share"], r["bold_fragments"], "||", r["statement"][:90])
