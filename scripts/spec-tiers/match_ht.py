"""Join the parsed Higher-tier statements to the database's Edexcel/OCR GCSE spec points."""
import json, re, unicodedata
db = json.load(open("db_points.json"))
by_code = {}
for p in db:
    by_code.setdefault((p["topics"]["board"], p["topics"]["subject"], p["code"]), p)
def norm(s): return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", s.lower())).strip()

found = []   # {board, subject, code, db_code, kind: full|partial, fragments, statement}
unmatched = []
for subj in ["biology", "chemistry", "physics"]:
    for r in json.load(open(f"edx_{subj}.json")):
        code = f"EDEX {r['code']}"
        p = by_code.get(("edexcel", subj, code))
        if not p: unmatched.append(("edexcel", subj, r["code"])); continue
        if r["bold_share"] >= 0.9: found.append(dict(board="edexcel", subject=subj, code=code, kind="full", fragments=[], src=r["statement"], p=p))
        elif r["bold_share"] >= 0.05: found.append(dict(board="edexcel", subject=subj, code=code, kind="partial", fragments=r["bold_fragments"], src=r["statement"], p=p))
    for r in json.load(open(f"ocr_{subj}.json")):
        raw = r["code"]; code = "OCR " + (raw[1:] if subj == "biology" else raw)
        p = by_code.get(("ocr", subj, code))
        if not p: unmatched.append(("ocr", subj, raw)); continue
        frags = r["lo"]["bold_fragments"] + r["inc"]["bold_fragments"]
        if r["code_bold"]: found.append(dict(board="ocr", subject=subj, code=code, kind="full", fragments=[], src=r["lo"]["text"], p=p))
        elif frags: found.append(dict(board="ocr", subject=subj, code=code, kind="partial", fragments=frags, src=r["lo"]["text"] + " | " + r["inc"]["text"], p=p))

# DB points the specs never mentioned (sanity: every Edexcel/OCR point should be in the spec)
spec_codes = {("edexcel", s, f"EDEX {r['code']}") for s in ["biology","chemistry","physics"] for r in json.load(open(f"edx_{s}.json"))}
spec_codes |= {("ocr", s, "OCR " + (r["code"][1:] if s == "biology" else r["code"])) for s in ["biology","chemistry","physics"] for r in json.load(open(f"ocr_{s}.json"))}
db_only = [(p["topics"]["board"], p["topics"]["subject"], p["code"]) for p in db if (p["topics"]["board"], p["topics"]["subject"], p["code"]) not in spec_codes]

print("HT full:", sum(f["kind"] == "full" for f in found), "partial:", sum(f["kind"] == "partial" for f in found))
import collections
print(dict(collections.Counter((f["board"], f["subject"], f["kind"]) for f in found)))
print("spec codes not in DB:", unmatched)
print("DB codes not in spec:", len(db_only), db_only[:40])
# Can each partial fragment be located in the DB description?
for f in found:
    if f["kind"] != "partial": continue
    d = f["p"]["description"]; nd = norm(d)
    for fr in f["fragments"]:
        print("PARTIAL", f["code"], "| frag:", fr[:70], "| in db:", norm(fr) in nd)
    print("     db:", d[:200])
# Does each full statement's wording agree with the DB description? (first 6 words)
bad = 0
for f in found:
    if f["kind"] != "full": continue
    a = norm(f["src"]).split()[:5]; b = norm(f["p"]["description"]).split()
    if not a or " ".join(a) not in " ".join(b): bad += 1; print("WORDING?", f["code"], "| spec:", f["src"][:70], "| db:", f["p"]["description"][:70])
print("full statements whose opening words differ from the DB:", bad)
json.dump([{k: v for k, v in f.items() if k != "p"} | {"id": f["p"]["id"], "description": f["p"]["description"], "updated_at": f["p"]["updated_at"]} for f in found], open("ht_found.json", "w"), indent=1, ensure_ascii=False)
