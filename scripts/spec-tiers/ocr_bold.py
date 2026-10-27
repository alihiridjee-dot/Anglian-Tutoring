"""OCR Gateway spec (rotated content tables, sometimes two per page): every learning outcome
with the share of its letters in bold, for the statement and its 'To include' guidance.
'Statements shown in bold type will only be tested in the Higher Tier papers.'"""
import sys, re, json, pymupdf
CODE = re.compile(r"^([BCP]\d{1,2}\.\d[a-z])\s*þ?$")
HEADERS = ["Learning outcomes", "To include", "Maths", "Working", "Practical suggestions"]
def collect(ls):
    text, bl, letters, frags, cur = [], 0, 0, [], []
    for l in sorted(ls, key=lambda l: l["x0"]):
        for s in l["spans"]:
            t = s["text"]; n = sum(ch.isalpha() for ch in t); b = "Bold" in s["font"]
            letters += n
            if b: bl += n; cur.append(t)
            elif n:
                if cur: frags.append(" ".join("".join(cur).split())); cur = []
            text.append(t)
        text.append(" ")
    if cur: frags.append(" ".join("".join(cur).split()))
    return {"text": " ".join("".join(text).split()), "bold_share": round(bl / letters, 3) if letters else 0, "bold_fragments": [f for f in frags if f]}
def parse(path):
    doc = pymupdf.open(path)
    rows, seen, pending, last_tables = [], set(), None, None
    for pno in range(doc.page_count):
        lines = []
        for b in doc[pno].get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                spans = [s for s in l["spans"] if s["text"].strip()]
                if not spans: continue
                x0, y0, x1, y1 = l["bbox"]
                lines.append({"x0": x0, "y1": y1, "spans": spans, "text": "".join(s["text"] for s in spans).strip()})
        heads = sorted([(l["y1"], h) for l in lines if l["x0"] < 110 for h in HEADERS if l["text"].startswith(h)], reverse=True)
        tables = []
        for y1, h in heads:
            if h == "Learning outcomes": tables.append({"lo": y1})
            elif tables and h not in tables[-1]: tables[-1][h] = y1
        if not tables and last_tables and any(CODE.match(l["text"]) for l in lines):
            tables = last_tables          # a table continued from the previous page, without its header row
        if tables: last_tables = tables
        for t in tables:
            if "To include" not in t: continue
            lo_top, lo_bot = t["lo"] + 6, t["To include"] + 6
            inc_bot = t.get("Maths", t["To include"] - 220) + 6
            def band(l):
                if lo_bot < l["y1"] <= lo_top: return "lo"
                if inc_bot < l["y1"] <= lo_bot: return "inc"
                return None
            codes = sorted([l for l in lines if CODE.match(l["text"]) and band(l) == "lo"], key=lambda l: l["x0"])
            if not codes: continue
            bounds = [c["x0"] - 3 for c in codes] + [10_000]
            groups = [{"code": CODE.match(c["text"]).group(1), "page": pno + 1, "code_bold": "Bold" in c["spans"][0]["font"], "lo": [], "inc": []} for c in codes]
            for l in lines:
                bd = band(l)
                if not bd or CODE.match(l["text"]) or l["x0"] < 110: continue
                k = next((i for i in range(len(codes)) if bounds[i] <= l["x0"] < bounds[i + 1]), None)
                if k is None:
                    if pending is not None and l["x0"] < bounds[0]: pending[bd].append(l)
                    continue
                groups[k][bd].append(l)
            for g in groups:
                if g["code"] in seen: continue
                seen.add(g["code"]); pending = g; rows.append(g)
    return [{"code": g["code"], "page": g["page"], "code_bold": g["code_bold"], "lo": collect(g["lo"]), "inc": collect(g["inc"])} for g in rows]
if __name__ == "__main__":
    rows = parse(sys.argv[1]); json.dump(rows, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
    full = [r for r in rows if r["lo"]["bold_share"] >= 0.9]
    print(f"{len(rows)} outcomes; {len(full)} fully bold: {' '.join(r['code'] for r in full)}")
    for r in rows:
        if r["code_bold"] != (r["lo"]["bold_share"] >= 0.9): print("MISMATCH", r["code"], "p", r["page"], r["code_bold"], r["lo"]["bold_share"], "||", r["lo"]["text"][:120])
        elif 0.05 <= r["lo"]["bold_share"] < 0.9: print("PART-LO", r["code"], r["lo"]["bold_share"], r["lo"]["bold_fragments"], "||", r["lo"]["text"][:100])
        if r["inc"]["bold_share"] >= 0.05 and r["lo"]["bold_share"] < 0.9: print("PART-INC", r["code"], r["inc"]["bold_share"], r["inc"]["bold_fragments"], "||", r["inc"]["text"][:100])
