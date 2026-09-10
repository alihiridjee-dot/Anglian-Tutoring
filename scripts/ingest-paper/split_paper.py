"""
Turn an exam question paper + its mark scheme into question rows.

This exists because the expensive-looking part of building the exemplar library
turned out not to need a model at all. Exam papers are typeset to a rigid
template, so the split is a parsing job. The only work left for a model
afterwards is dividing a multi-part question's mark scheme between its
sub-parts, and tagging spec points. Both are small and both are checkable.

    python3 split_paper.py QP.pdf MS.pdf              # human report
    python3 split_paper.py QP.pdf MS.pdf --json       # rows for insertion
    python3 split_paper.py QP.pdf MS.pdf --model-jobs # what still needs a model

Every split is verified against marks the paper states about itself, but the
boards do not agree on where. Edexcel prints "Total for Question N = M marks"
in both documents. PMT topic papers put a "Total N" line in the scheme only.
Real OCR papers state no per-question total anywhere, so those can only be
checked against the paper total on the cover — a weaker guarantee, and the
reason the report always prints found-vs-stated marks as well.

Nothing is written to the database. Rows that fail a check are marked `flags`
rather than dropped, because a silently missing question is worse than a
visible one to look at.

Requires pypdf. Board patterns live in PROFILES — adding a board should be data,
not code. All four profiles have now been run against real papers, but they are
not equally good: Edexcel and OCR recover 88-97% of a paper's marks, while AQA
reconciles roughly half its questions and states no paper total to fall back on.
Treat AQA output as needing a closer read until that improves.
"""
import re
import sys
import json
import collections
from pypdf import PdfReader

# --------------------------------------------------------------------------
# Board profiles. Adding a board should be data, not code.
# --------------------------------------------------------------------------

PROFILES = {
    # PhysicsAndMathsTutor topic compilations. Unlike real OCR papers these
    # carry a per-question "Total N" line in the scheme, so they self-check.
    "ocr_pmt": {
        "VERIFIED": True,               # 1.1 The Particle Model (F)
        # The PMT stamp is rotated text and never reaches the layout-mode
        # extraction, so a topic paper is identified by OCR's answer-box
        # convention and the absence of any awarding-body paper furniture.
        "detect": ["Your answer"],
        # A topic compilation is defined by the ABSENCE of board furniture, so
        # every marker that identifies a real paper has to rule it out.
        "exclude": [
            r"J2\d\d/\d", r"total mark for this paper",
            r"\b8\d{3}/[12][FH]\b", r"IB/[A-Z]/", r"Pearson Edexcel",
        ],
        "checksum": "per_question",
        # "7(a)." or a bare "(b)." continuing the previous question over a page
        "q_start": r"^[ \t]*(?:(?P<num>\d+)(?:\((?P<part>[a-z])\))?|\((?P<bare>[a-z])\))\.[ \t]",
        "sub": r"^[ \t]*(i{1,3}v?|iv|v)\.[ \t]",
        "marks": r"\[(\d+)\]",
        "option": r"^\s*([A-D])\s{2,}(.+)$",
        "ms_total": r"^Total\s+(\d+)\s*$",
        "commentary_x": (345, 10000),
        "ms_starts_at": None,
        "noise": [
            "PhysicsAndMathsTutor.com", "Examiner's Comments", "Examiner’s Comments",
            "Assessment for learning", "Answer/Indicative content", "Mark scheme",
            "END OF QUESTION PAPER", "Your answer",
        ],
    },
    # Real OCR Gateway papers. No per-question totals exist anywhere in either
    # document, so these can only be checked against the paper total on the cover.
    "ocr_a": {
        "VERIFIED": True,               # J249/01 2018 Physics, J247/01 2019 Biology
        "detect": [r"J2\d\d/\d"],       # J249/01 Physics, J247/01 Biology, J248/01 Chemistry
        "checksum": "paper_total",
        "q_start": r"^[ \t]*(?P<num>\d+)[ \t]+(?=[A-Z(])",   # "16 A student..." — no dot
        "sub": r"^[ \t]*\(([a-z])\)[ \t]*(?:\((i{1,3}v?|iv|v)\))?|^[ \t]*\((i{1,3}v?|iv|v)\)[ \t]",
        "marks": r"\[(\d+)\]",
        "option": r"^\s*([A-D])\s+(.+)$",
        "ms_total": None,
        "commentary_x": None,
        "ms_starts_at": r"Question\s+Answer\s+Marks",
        "qp_starts_at": r"SECTION A",
        "noise": [
            "PMT", "Turn over", "BLANK PAGE", "SECTION A", "SECTION B",
            "Answer all the questions.", "Your answer",
        ],
    },
    # Pearson Edexcel. Carries "Total for Question N = M marks" in BOTH papers,
    # so the checksum can be taken from either side.
    "edexcel": {
        "VERIFIED": True,               # 1PH0/1F 2018 Physics, 1CH0/1F 2018 Chemistry
        "detect": ["Pearson Edexcel", "Total for Question"],
        "checksum": "per_question",
        "q_start": r"^[ \t]*\*?[ \t]*(?:(?P<num>\d+)[ \t]+\*?\((?P<part>[a-z])\)|(?P<num2>\d+)[ \t]+(?=[A-Z])|\((?P<bare>[a-hj-uw-z])\)[ \t])",
        "sub": r"^[ \t]*\*?[ \t]*\((i{1,3}v?|iv|v)\)[ \t]",
        "marks": r"\((\d+)\)\s*$",
        "option": r"^\s*(?:■|☒|□|)\s*([A-D])\s+(.+)$",
        "ms_total": r"Total for Question\s+\d+\s*=\s*(\d+)\s*marks?",
        "commentary_x": None,
        "ms_starts_at": r"Question\s+Answer\s+Mark",
        "qp_starts_at": r"Answer ALL questions",
        "noise": [
            "Pearson Edexcel", "Turn over", "BLANK PAGE", "DO NOT WRITE IN THIS AREA",
            "Answer ALL questions.", "Write your answers in the spaces provided.",
        ],
    },
    # AQA. Numbers questions as spaced digits — "0 1" is question 1, "0 1 . 3"
    # is part 1.3 — so there are no letters and the number carries the label.
    # Its scheme is the only one here that names the specification reference.
    "aqa": {
        "VERIFIED": True,               # 8462/1H 2018, 8462/1F 2019 Chemistry
        "detect": [r"IB/[A-Z]/\w+/8\d{3}/", r"\b8\d{3}/[12][FH]\b"],
        "checksum": "per_question",
        "q_start": r"^[ \t]*0[ \t]*(?P<num>\d)[ \t]+(?=[A-Z])",
        "sub": r"^[ \t]*0[ \t]*\d[ \t]*\.[ \t]*(\d)[ \t]",
        "marks": r"\[(\d+)[ \t]*marks?\]",
        "option": r"^[ \t]*([A-D])[ \t]+(.+)$",
        "ms_total": r"^[ \t]*Total[ \t]+(\d+)[ \t]*$",
        "commentary_x": (260, 440),     # "Extra information" sits before the mark
        "ms_starts_at": r"Question\s+An\s*sw\s*er",
        "qp_starts_at": None,
        "spec_ref": r"\b(\d+\.\d+\.\d+(?:\.\d+)?)\b",
        "ms_label": r"^[ \t]*0?(\d{1,2})[ \t]*\.[ \t]*\d[ \t]*",
        "noise": ["Do not write", "outside the", "Turn over", "box"],
    },
}

PAPER_TOTAL = re.compile(r"total mark for this paper is\s+(\d+)", re.I)


def detect_profile(text):
    """Identify the board from the question paper and mark scheme together.

    Neither document alone is reliable: a PMT topic paper carries no board
    marking on its question paper, and a real OCR paper scanned by PMT carries
    the PMT stamp — so a profile can also rule itself out.
    """
    for name, p in PROFILES.items():
        if not any(re.search(m, text) for m in p["detect"]):
            continue
        if any(re.search(x, text) for x in p.get("exclude", [])):
            continue
        return name
    return None


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

def raw_text(path):
    reader = PdfReader(path)
    return "\n".join(
        (page.extract_text(extraction_mode="layout") or "") for page in reader.pages
    )


def commentary_fragments(path, band):
    """Text fragments living in the right-hand guidance column.

    Layout-mode text has the right reading order but weaves the examiner
    commentary into the answers line by line. Coordinates have the column
    boundary but lose the reading order. So use coordinates only to learn which
    fragments are commentary, then delete exactly those from the layout text.
    """
    if band is None:
        return set()
    lo, hi = band
    reader = PdfReader(path)
    right, left = collections.Counter(), collections.Counter()
    for page in reader.pages:
        def visit(text, cm, tm, font, size):
            t = text.strip()
            if len(t) >= 3:
                (right if lo <= tm[4] < hi else left)[t] += 1
        page.extract_text(visitor_text=visit)
    # A fragment also seen in the answer column is normally kept, so wording
    # shared with a real mark scheme survives. That caution is only warranted
    # for short fragments though — a long phrase appearing on both sides is the
    # extractor splitting a commentary line, not a genuine collision.
    return {t for t in right if len(t) >= 15 or t not in left}


def clean_ms(path, profile):
    text = raw_text(path)
    # Board mark schemes open with pages of marking guidance and corporate
    # boilerplate. Nothing before the first scheme table is wanted.
    if profile["ms_starts_at"]:
        m = re.search(profile["ms_starts_at"], text)
        if m:
            text = text[m.start():]
    for frag in sorted(commentary_fragments(path, profile["commentary_x"]), key=len, reverse=True):
        text = text.replace(frag, " ")
    for n in profile["noise"]:
        text = text.replace(n, " ")
    text = re.sub(r"[ \t]+", " ", text)
    # The column header repeats on every page once its longer cells are gone.
    text = re.sub(r"^\s*(?:Question|Marks|Guidance|Number)(?:\s+(?:Question|Marks|Guidance|Number))*\s*$",
                  "", text, flags=re.M)
    return "\n".join(l.rstrip() for l in text.split("\n"))


# --------------------------------------------------------------------------
# Question paper
# --------------------------------------------------------------------------

FIGURE = re.compile(r"\b(diagram|bar chart|figure|graph|table|image|photograph)\b", re.I)

# An assessment-objective marker such as "(2 × AO1.2)" is wrapped by the column
# and arrives split across lines, so the opening "(2 ×" and the "AO1.2)" have to
# be removable independently or they leave orphaned brackets behind.
AO_CODE = re.compile(
    r"\(\s*\d\s*×?\s*AO\s?\d[\.\d]*[a-z]?\s*\)"   # complete: (2 × AO1.2)
    r"|\(?\s*AO\s?\d[\.\d]*[a-z]?\s*\)"           # tail half: AO1.2)
    r"|\(\s*\d\s*×\s*(?!\S)"                      # head half: (2 ×
    r"|\(\s*\d\s*×$",
    re.M,
)


def parse_questions(text, profile):
    q_start = re.compile(profile["q_start"], re.M)
    sub_re = re.compile(profile["sub"], re.M)
    marks_re = re.compile(profile["marks"], re.M)
    option_re = re.compile(profile["option"], re.M)

    text = DRAFT_MARK.sub(" ", text)
    text = re.sub(r"^\s*\*[A-Z]\d{5,}[A-Z]?\d*\*\s*$", "", text, flags=re.M)  # Edexcel page codes
    text = re.sub(r"[ \t]+", " ", text)
    # Nothing before the instructions is a question; covers and formulae sheets
    # otherwise produce phantom low-numbered questions. This has to happen
    # before noise stripping, because the marker is itself listed as noise.
    if profile.get("qp_starts_at"):
        m = re.search(profile["qp_starts_at"], text)
        if m:
            text = text[m.end():]
    for n in profile["noise"]:
        text = text.replace(n, " ")

    starts, current = [], None
    for m in q_start.finditer(text):
        g = m.groupdict()
        num = g.get("num") or g.get("num2")
        part, bare = g.get("part"), g.get("bare")
        if bare:
            if current is None:
                continue
            num, part = current, bare
        else:
            current = num
        starts.append((m.start(), num, part))

    rows = []
    for i, (pos, num, part) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        body = text[pos:end]
        subs = [(m.start(), m.group(1)) for m in sub_re.finditer(body)]
        if subs:
            for j, (spos, roman) in enumerate(subs):
                send = subs[j + 1][0] if j + 1 < len(subs) else len(body)
                rows.append(build_row(num, part, roman, body[spos:send], marks_re, option_re, profile))
        else:
            rows.append(build_row(num, part, None, body, marks_re, option_re, profile))
    return rows


def build_row(num, part, roman, body, marks_re, option_re, profile):
    marks = marks_re.findall(body)
    options = option_re.findall(body)
    label = num + (f"({part})" if part else "") + (f"({roman})" if roman else "")

    prompt = marks_re.sub("", body)
    prompt = re.sub(profile["q_start"], "", prompt, count=1, flags=re.M)
    prompt = re.sub(profile["sub"], "", prompt, count=1, flags=re.M)
    if options:
        prompt = option_re.sub("", prompt)
    prompt = re.sub(r"\.{4,}", " ", prompt)          # dotted answer lines
    prompt = fix_units(prompt)
    prompt = re.sub(r"\n{2,}", "\n", prompt).strip()

    flags = []
    if not marks:
        flags.append("no mark allocation found")
    if len(marks) > 1:
        flags.append(f"{len(marks)} mark tags in one part")
    if FIGURE.search(body):
        flags.append("needs image")
    if len(prompt) < 15:
        flags.append("prompt suspiciously short")

    return {
        "label": label, "q": num, "part": part, "sub": roman,
        "prompt": prompt,
        "marks": int(marks[-1]) if marks else None,
        "options": [{"letter": l, "text": fix_units(t.strip())} for l, t in options] or None,
        "flags": flags,
    }


DRAFT_MARK = re.compile(
    r"\b(?:D?R?AFT(?:ex|x)?|e?x?emplar|DR|De)\b"
    r"|(?<=\s)[Rx](?=\s)",          # the stray single glyphs it also leaves
)
# Edexcel's typesetting kerns letters apart, so pypdf reads "curve" as "cur ve".
# Only joined where the tail is a known continuation, never on guesswork.
KERN_TAILS = r"(?:ve|face|ues|ure|ent|ing|ed|es|er|ce|ty|ly)"
KERNED = re.compile(rf"\b([a-z]{{2,}}) ({KERN_TAILS})\b")
KERN_WORDS = {
    "curve", "curves", "surface", "surfaces", "values", "feature", "features",
    "figure", "figures", "measure", "different", "difference", "temperature",
    "structure", "pressure", "movement", "moving", "energy",
}


def fix_units(s):
    """Undo what the text layer mangles: superscripts, watermarks, kerning."""
    s = DRAFT_MARK.sub(" ", s)
    s = re.sub(r"\b(m|cm|mm|km)\s*3\b", r"\1³", s)
    s = re.sub(r"\b(m|cm|mm|km)\s*2\b", r"\1²", s)
    s = re.sub(r"\b(kg|g)\s*/\s*(m|cm)\s*3\b", r"\1/\2³", s)
    # Rejoin a split word only when the join produces a word we recognise —
    # otherwise "the value" would become "thevalue".
    s = KERNED.sub(lambda m: m.group(1) + m.group(2)
                   if (m.group(1) + m.group(2)).lower() in KERN_WORDS
                   else m.group(0), s)
    return re.sub(r"[ \t]{2,}", " ", s)


# --------------------------------------------------------------------------
# Mark scheme
# --------------------------------------------------------------------------

def plausible(rows):
    """Drop rows whose question number cannot be real.

    Figure labels, axis values and stray digits match the "<number> <Capital>"
    opener as readily as a question does. A real paper numbers its questions
    from 1 in an unbroken-ish run, so anything outside that is furniture.
    """
    nums = sorted({int(r["q"]) for r in rows})
    keep, prev = set(), 0
    for n in nums:
        if n >= 1 and n - prev <= 3:      # tolerate a question the parser missed
            keep.add(n)
            prev = n
    return [r for r in rows if int(r["q"]) in keep]


def parse_scheme(text, profile, expected_qs):
    """Segment the mark scheme into one block per question.

    Keyed to the question numbers the paper actually produced, so a stray
    figure in the text ("1000 kg/m3") can never be mistaken for a question.
    """
    # Real OCR papers state no per-question total anywhere, so there is nothing
    # to segment on but the question numbers themselves.
    total_re = re.compile(profile["ms_total"], re.M) if profile["ms_total"] else None
    blocks, cur, qn, nxt = {}, [], None, 0
    # In a multi-column scheme the answer column can start rendering above the
    # row where the question number sits, so lines arriving after one question's
    # total belong to the next one. Hold them rather than discarding them.
    orphans = []

    for line in text.split("\n"):
        t = line.strip()
        if not t:
            continue
        tm = total_re.search(t) if total_re else None
        if tm:
            if qn:
                blocks[qn] = {"body": "\n".join(cur), "total": int(tm.group(1))}
            cur, qn, orphans = [], None, []
            continue
        # Where the scheme labels every part with its own question number
        # ("01.3"), read it directly. Walking in step with the question paper
        # desynchronises for the rest of the scheme as soon as one question is
        # missed, which turns one bad question into ten.
        if profile.get("ms_label"):
            lm = re.match(profile["ms_label"], t)
            if lm and str(int(lm.group(1))) in expected_qs:
                found = str(int(lm.group(1)))
                if found != qn:
                    if qn:
                        blocks[qn] = {"body": "\n".join(cur), "total": None}
                    qn, cur, orphans = found, orphans, []
                cur.append(t[lm.end():].strip())
                continue
            (cur if qn else orphans).append(t)
            continue

        m = re.match(r"^(\d{1,2})\b", t)
        num = str(int(m.group(1))) if m else None
        if num and num in expected_qs[nxt:nxt + 3]:
            nxt = expected_qs.index(num, nxt)
            if qn:
                blocks[qn] = {"body": "\n".join(cur), "total": None}
            qn, nxt = expected_qs[nxt], nxt + 1
            cur = orphans + [t[m.end():].strip()]
            orphans = []
            continue
        (cur if qn else orphans).append(t)
    if qn:
        blocks[qn] = {"body": "\n".join(cur), "total": None}
    return blocks


# Examiner commentary talks *about* candidates; a mark scheme talks to the
# marker. These words never legitimately appear in scheme text.
COMMENTARY_TELL = re.compile(
    r"\bcandidates?\b|\bvirtually\b|\bmost recognised\b|\bcommonly chosen\b"
    r"|\bwell answered\b|\bmis-spelling|\bresponse to\b",
    re.I,
)


def check(rows, blocks, profile):
    """Reconcile paper marks against scheme totals, and flag damaged text."""
    per_question = profile["checksum"] == "per_question"
    sums = collections.defaultdict(int)
    for r in rows:
        sums[r["q"]] += r["marks"] or 0

    report = []
    for qn in sorted(blocks, key=int):
        b = blocks[qn]
        body = AO_CODE.sub(" ", b["body"])
        flags = []
        if not per_question:
            pass                       # verified against the paper total instead
        elif b["total"] is None:
            flags.append("no total in scheme")
        elif sums[qn] != b["total"]:
            flags.append(f"paper {sums[qn]} vs scheme {b['total']}")
        if profile["commentary_x"] and COMMENTARY_TELL.search(body):
            flags.append("commentary residue")
        if body.count("(") != body.count(")"):
            flags.append("unbalanced parens - text may be damaged")
        report.append({
            "q": qn, "parts": sum(1 for r in rows if r["q"] == qn),
            "paper_marks": sums[qn], "scheme_total": b["total"],
            "scheme": re.sub(r"\s+", " ", body).strip(), "flags": flags,
        })
    return report


def model_jobs(rows, report):
    """The only work a model still has to do: divide a multi-part question's
    scheme between its sub-parts. Verifiable — the marks are already known."""
    jobs = []
    for entry in report:
        parts = [r for r in rows if r["q"] == entry["q"]]
        if len(parts) > 1:
            jobs.append({
                "question": entry["q"],
                "parts": [{"label": r["label"], "marks": r["marks"]} for r in parts],
                "scheme_to_split": entry["scheme"],
                "must_sum_to": entry["scheme_total"],
            })
    return jobs


# --------------------------------------------------------------------------

def main(qp_path, ms_path, mode):
    qp_raw = raw_text(qp_path)
    ms_raw = raw_text(ms_path)
    name = detect_profile(qp_raw + "\n" + ms_raw)
    if not name:
        sys.exit("Could not identify the board. Add a profile or pass one explicitly.")
    profile = PROFILES[name]

    rows = parse_questions(qp_raw, profile)
    rows = plausible(rows)
    expected = [str(n) for n in sorted({int(r["q"]) for r in rows})]
    blocks = parse_scheme(clean_ms(ms_path, profile), profile, expected)
    if profile["ms_total"]:
        for qn, total in re.findall(r"Total for Question\s+(\d+)\s*=\s*(\d+)\s*marks?", qp_raw):
            if qn in blocks and blocks[qn]["total"] is None:
                blocks[qn]["total"] = int(total)
    report = check(rows, blocks, profile)

    stated = PAPER_TOTAL.search(qp_raw)
    stated = int(stated.group(1)) if stated else None
    found = sum(r["marks"] or 0 for r in rows)

    if mode == "--json":
        print(json.dumps({"profile": name, "rows": rows, "scheme": report}, indent=1, ensure_ascii=False))
        return
    if mode == "--model-jobs":
        print(json.dumps(model_jobs(rows, report), indent=1, ensure_ascii=False))
        return

    warn = "" if profile["VERIFIED"] else "   *** PROFILE UNVERIFIED ***"
    print(f"Profile: {name}{warn}")
    print(f"Rows extracted: {len(rows)}\n")
    print(f"{'label':11} {'marks':>5}  flags")
    print("-" * 72)
    for r in rows:
        print(f"{r['label']:11} {str(r['marks']):>5}  {', '.join(r['flags'])}")

    print(f"\n{'Q':4} {'parts':>5} {'paper':>5} {'scheme':>6}  status")
    print("-" * 72)
    clean = 0
    for e in report:
        clean += not e["flags"]
        status = "CLEAN" if not e["flags"] else "FLAG: " + ", ".join(e["flags"])
        print(f"{e['q']:4} {e['parts']:>5} {e['paper_marks']:>5} {str(e['scheme_total']):>6}  {status}")
    total = len(report) or 1
    print(f"\n  {clean}/{len(report)} questions reconcile ({clean / total * 100:.0f}%)")
    if stated is not None:
        verdict = "OK" if found == stated else f"MISSING {stated - found} MARKS"
        print(f"  paper total: found {found} of {stated} stated on the cover -- {verdict}")
    else:
        print("  paper total: not stated on the cover, cannot verify coverage")
    print(f"  {sum(1 for r in rows if 'needs image' in r['flags'])} rows need an image")
    print(f"  {len(model_jobs(rows, report))} questions need the scheme split by a model")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "--report")
