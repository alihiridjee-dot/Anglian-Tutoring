"""Turn ht_found.json into the exact description edits: full statements get ' (HT only)' after the
statement; partly bold statements get a '(…: HT only)' note naming the bold part."""
import json, re
found = json.load(open("ht_found.json"))
JUNK = re.compile(r"Topic content|Learning outcomes|To include|Underlying knowledge|Mathematical learning outcomes|^Reference|^apply: PM|Equations in Physics")
PARTIAL_EDITS = {
  "EDEX 1.5":   ("(e) calculations with numbers written in standard form", "(e) calculations with numbers written in standard form (HT only: e)"),
  "EDEX 7.12B": ("(b) vasoconstriction (c) vasodilation", "(b) vasoconstriction (c) vasodilation (HT only: b and c)"),
  "EDEX 2.23":  ("conservation of momentum in collisions", "conservation of momentum in collisions (HT only: collision interactions and momentum)"),
  "EDEX 2.31":  ("typical situations on a public road", "typical situations on a public road (HT only: estimating the forces)"),
  "EDEX 4.10":  ("change of direction and speed", "change of direction and speed (HT only: speed)"),
  "OCR 3.2h":   ("auxins, gibberellins and ethene. To include: controlling growth, controlling germination, fruit ripening, flower opening and shedding of leaves.",
                 "auxins, gibberellins and ethene (HT only: gibberellins and ethene). To include: controlling growth, controlling germination, fruit ripening, flower opening and shedding of leaves (HT only: all but controlling growth)."),
  "OCR C3.1b":  ("balanced chemical equations and half equations.", "balanced chemical equations and half equations (HT only: half equations)."),
  "OCR C3.4d":  ("the equations and half equations of the reactions at the electrodes.", "the equations and half equations of the reactions at the electrodes (HT only: half equations)."),
}
changes, skipped = [], []
for f in found:
    d = f["description"]; code = f["code"]
    if "(HT only" in d: skipped.append((code, "already marked")); continue
    if f["kind"] == "full":
        if f["board"] == "ocr":
            if ". To include:" in d: new = d.replace(". To include:", " (HT only). To include:", 1)
            elif d.endswith("."): new = d[:-1] + " (HT only)."
            else: new = d + " (HT only)"
        else:
            new = d + " (HT only)"
    else:
        frags = [x for x in f["fragments"] if not JUNK.search(x)]
        if not frags: continue                      # header text caught by the parser, not a real bold fragment
        if code not in PARTIAL_EDITS: skipped.append((code, "partial without a hand edit: " + " / ".join(frags)[:80])); continue
        old, rep = PARTIAL_EDITS[code]
        if old not in d: skipped.append((code, "partial text not found: " + old[:60])); continue
        new = d.replace(old, rep, 1)
    changes.append({"id": f["id"], "code": code, "board": f["board"], "subject": f["subject"], "kind": f["kind"], "prev": d, "new": new, "updated_at": f["updated_at"]})
json.dump(changes, open("ht_changes.json", "w"), indent=1, ensure_ascii=False)
import collections
print(len(changes), "changes", dict(collections.Counter((c["board"], c["subject"]) for c in changes)))
print("skipped:", skipped)
for c in changes[:3] + [c for c in changes if c["kind"] == "partial"]: print(" ", c["code"], "→", c["new"][-110:])
