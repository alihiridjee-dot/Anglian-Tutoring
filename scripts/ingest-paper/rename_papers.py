"""
Give a folder of downloaded exam papers names that identify them.

Papers arrive from PMT called "June 2019 MS-4.pdf", which says nothing about
which board, subject or tier it is — two files an hour apart can be AQA Biology
and Edexcel Chemistry. Pairing those by hand is the slow, error-prone step
before any of the parsing can start, and pairing them wrongly is worse than not
pairing them: a question paper checked against another subject's mark scheme
still produces rows.

So identify each file from its own contents — every board prints its
specification code on the page — and name it after what it actually is:

    edexcel-physics-gcse-2018-jun-p1F-QP.pdf

    python3 rename_papers.py papers/incoming              # show what it would do
    python3 rename_papers.py papers/incoming --apply      # copy into papers/named/
    python3 rename_papers.py ~/Downloads --out /some/dir  # or anywhere else

Point it at a folder holding only papers. It will happily read a Downloads
folder, but it opens every PDF it finds to see what it is, so 500 unrelated
documents cost minutes for nothing.

Copies rather than moves, so the originals stay where they are and a wrong
guess costs nothing. Files it cannot identify are listed and left alone —
never guessed at, because a mis-paired mark scheme is silent corruption.
"""
import re
import sys
import shutil
import filecmp
import pathlib
import collections
from pypdf import PdfReader

# Specification codes, which every board prints on every page. The code is the
# only reliable identifier: filenames lie and cover pages vary by year.
#
# The separator between the code and the paper varies by document and by board:
# a question paper prints "1PH0/    1F" (padded to fit a box), while its mark
# scheme prints "1PH0_1F_1806_MS" in a publications code. Matching on "/" alone
# finds the question papers and orphans every scheme.
SEP = r"[\s/_-]*"

# How each board prints a paper after its code: the paper as one capture group,
# then the tier (or the empty string where the board has none).
NUMBERED = r"0?([1-9])"        # 8461/1F, 1PH0/1F
OCR_PAPER = r"0([1-9])\b"      # J247/01
# Cambridge prints a component: the paper, then a variant set for other time
# zones (0625/41, /42, /43). Variants of one paper are different papers, so the
# whole component is the paper; tier is already in it (2 and 4 are Extended).
COMPONENT = r"([1-6][1-3])\b"
# OxfordAQA's sciences are two untiered papers: 9203/1, 9203/2.
TWO_PAPERS = r"([12])\b"
# AQA A-level Physics splits Paper 3 into Section A (7408/3A) and five option
# papers (7408/3BA to 3BE), each sat by different students, so the letters are
# part of the paper's name. Papers 1 and 2 have none; the letters have to follow
# the number directly, or "7408/1 A-level" would read as a Paper 1A. A cover can
# space the option off ("7408/3B C"), and missing it is worse than unpaired: the
# scheme's marking notes mention 7408/3A, so it read as Section A's scheme.
AQA_PHYSICS_PAPER = r"([1-3])(A|B ?[A-E]|)(?![A-Za-z0-9])"
# Cambridge's AS & A Level papers ran a fourth variant from June 2025 (9700/14),
# which the IGCSE's three would not read at all.
CAMBRIDGE_AL_COMPONENT = r"([1-5][1-9])\b"

_CODES = [
    # AQA GCSE — tier F or H
    ("8461", "aqa", "biology", "gcse", NUMBERED, "[FH]"),
    ("8462", "aqa", "chemistry", "gcse", NUMBERED, "[FH]"),
    ("8463", "aqa", "physics", "gcse", NUMBERED, "[FH]"),
    # AQA Combined Science: Trilogy prints its subject between code and paper
    # (8464/B/1F). The curriculum files it by subject at the gcse_trilogy level.
    (f"8464{SEP}B", "aqa", "biology", "gcse_trilogy", NUMBERED, "[FH]"),
    (f"8464{SEP}C", "aqa", "chemistry", "gcse_trilogy", NUMBERED, "[FH]"),
    (f"8464{SEP}P", "aqa", "physics", "gcse_trilogy", NUMBERED, "[FH]"),
    ("8465", "aqa", "combined-synergy", "gcse", NUMBERED, "[FH]"),
    # Pearson Edexcel GCSE
    ("1BI0", "edexcel", "biology", "gcse", NUMBERED, "[FH]"),
    ("1CH0", "edexcel", "chemistry", "gcse", NUMBERED, "[FH]"),
    ("1PH0", "edexcel", "physics", "gcse", NUMBERED, "[FH]"),
    ("1SC0", "edexcel", "combined", "gcse", NUMBERED, "[FH]"),
    # Pearson Edexcel International GCSE — the subject's letter, then R for the
    # paper's second version: 4CH1/1C and 4CH1/1CR sit in the same session with
    # different questions, so the R has to reach the name or the two pair up.
    ("4BI1", "edexcel", "biology", "igcse", NUMBERED, "BR?"),
    ("4CH1", "edexcel", "chemistry", "igcse", NUMBERED, "CR?"),
    ("4PH1", "edexcel", "physics", "igcse", NUMBERED, "PR?"),
    # Cambridge IGCSE
    ("0610", "cambridge", "biology", "igcse", COMPONENT, ""),
    ("0620", "cambridge", "chemistry", "igcse", COMPONENT, ""),
    ("0625", "cambridge", "physics", "igcse", COMPONENT, ""),
    # OxfordAQA International GCSE
    ("9201", "oxford_aqa", "biology", "igcse", TWO_PAPERS, ""),
    ("9202", "oxford_aqa", "chemistry", "igcse", TWO_PAPERS, ""),
    ("9203", "oxford_aqa", "physics", "igcse", TWO_PAPERS, ""),
    # OCR Gateway A — no tier in the code, papers are 01/02
    ("J247", "ocr", "biology", "gcse", OCR_PAPER, ""),
    ("J248", "ocr", "chemistry", "gcse", OCR_PAPER, ""),
    ("J249", "ocr", "physics", "gcse", OCR_PAPER, ""),
    ("J250", "ocr", "combined", "gcse", OCR_PAPER, ""),
    # AQA A-level — three untiered papers (the AS codes 7401/7404/7407 are a
    # different qualification and stay unrecognised)
    ("7402", "aqa", "biology", "alevel", NUMBERED, ""),
    ("7405", "aqa", "chemistry", "alevel", NUMBERED, ""),
    ("7408", "aqa", "physics", "alevel", AQA_PHYSICS_PAPER, ""),
    # OCR A A-level — papers 01/02/03. The first schemes (2017–18) print the
    # unit with the spec's letter on it, H420A/01.
    ("H420A?", "ocr", "biology", "alevel", OCR_PAPER, ""),
    ("H432A?", "ocr", "chemistry", "alevel", OCR_PAPER, ""),
    ("H556A?", "ocr", "physics", "alevel", OCR_PAPER, ""),
    # Pearson Edexcel A-level — Biology A (Salters-Nuffield) is 9BN0; Biology B
    # (9BI0) is not a course here
    ("9BN0", "edexcel", "biology", "alevel", NUMBERED, ""),
    ("9CH0", "edexcel", "chemistry", "alevel", NUMBERED, ""),
    ("9PH0", "edexcel", "physics", "alevel", NUMBERED, ""),
    # Cambridge International AS & A Level — components like the IGCSE's
    ("9700", "cambridge", "biology", "alevel", CAMBRIDGE_AL_COMPONENT, ""),
    ("9701", "cambridge", "chemistry", "alevel", CAMBRIDGE_AL_COMPONENT, ""),
    ("9702", "cambridge", "physics", "alevel", CAMBRIDGE_AL_COMPONENT, ""),
]

# Where a code may start. Pearson's 2018 A-level schemes put the date first in
# the publications code (1806_9CH0_03_MS), and \b sees no edge after an
# underscore. The GCSE codes keep \b: that library was named and loaded under
# it, and renaming a loaded paper orphans its rows.
_START = {"alevel": r"(?<![A-Za-z0-9])"}
_EDGE = r"\b"

SPECS = {
    _START.get(level, _EDGE) + rf"{code}{SEP}{paper}" + (rf"{SEP}({tier})" if tier else ""):
        (board, subject, level)
    for code, board, subject, level, paper, tier in _CODES
}
ALEVEL_SPECS = {p: spec for p, spec in SPECS.items() if spec[2] == "alevel"}

# Which sitting a paper belongs to. It is part of the name because the
# international boards set the same paper number more than once a year, so
# without it a January paper and its June namesake would pair with each
# other's mark schemes. A question paper prints the date it was sat ("Thursday
# 14 May 2020"); a mark scheme prints the series ("Summer 2020"). Both come
# down to the four sittings exam_exemplars.series stores.
_MONTHS = "January|February|March|May|June|October|November|Summer|Autumn|Winter"
SITTING = {"january": "jan", "february": "mar", "march": "mar", "may": "jun",
           "june": "jun", "summer": "jun", "october": "nov", "november": "nov",
           "autumn": "nov", "winter": "nov"}
SESSION = re.compile(rf"\b({_MONTHS})\s+(20\d\d)\b", re.I)
# Layout extraction splits words ("Nov ember 2021"), so look again with the
# spaces taken out. Capitalised only: squashed text is full of "may".
SESSION_SQUASHED = re.compile(rf"({_MONTHS})(20\d\d)(?!\d)")
# AQA prints its sitting on every page even when the cover has no date:
# IB/M/Jun21/8462/1F.
AQA_SITTING = re.compile(r"\bIB/[A-Z]/(Jan|Jun|Nov)(\d\d)/")
# Cambridge's page footer: component, then the series' months, then the year
# (0625/41/M/J/24 is May/June 2024).
CAMBRIDGE_SITTING = re.compile(r"\b(?:06[12][05]|970[0-2])/\d\d/(F/M|M/J|O/N)/(\d\d)\b")
CAMBRIDGE_SERIES = {"F/M": "mar", "M/J": "jun", "O/N": "nov"}
# Its cover names the series by both months, "May/June 2025". Some covers are
# set letter by letter ("M ay / J une 2 0 2 5 2 h ours"), and squashed, the year
# runs into the paper's length — "May/June20252hours" — which the squashed
# search refuses as a longer number. Two months with a slash between are never
# anything but a series, so its year is simply the four digits after them.
CAMBRIDGE_COVER_SQUASHED = re.compile(
    r"(?:February/|May/|October/)(March|June|November)(20\d\d)")
# Pearson's publications code carries the month: 1PH0_1F_1806_MS.
PUBLICATION = re.compile(r"_([0-9]{2})(0[1-9]|1[0-2])_")
PUBLICATION_SITTING = {1: "jan", 2: "mar", 3: "mar", 5: "jun", 6: "jun", 10: "nov", 11: "nov"}
# Pearson prints a question paper's number in the barcode on every page
# (*P62045A0136*), and its mark scheme names the paper it marks ("Question
# Paper Log Number P62045A"). Where a question paper carries no date, that is
# how it learns its sitting: from the scheme that names it, not from a guess.
PEARSON_PAPER = re.compile(r"\*(P\d{5}[A-Z]{1,2})\d{4}\*")
PEARSON_LOG = re.compile(r"Question\s+Paper\s+Log\s+Number\s+(P\d{5}[A-Z]{1,2})")
# The A-level schemes are looser about it: "Log Number: P77832A", "Log Number
# 65463" with no P and no letters, "P69306" with no letters — and the layout pass
# prints "Quest ion  Paper" and strands the letters, so it is read with the
# spaces squashed out. The five digits name the paper; the letters, where a
# scheme prints them, still have to agree.
PEARSON_LOG_LOOSE = re.compile(r"QuestionPaperLogNumber:?P?(\d{5})([A-Z]{1,2}(?![A-Za-z]))?")

# A sample or specimen paper was never sat, so it is filed as "sample" with no
# year — but only when the document says so itself, in the words the boards
# put on the cover or in the running header:
#   AQA      SPECIMEN MATERIAL (paper), MARK SCHEME – … – SPECIMEN (scheme)
#   OCR      Sample Question Paper, SAMPLE MARK SCHEME, Sample Assessment Material
#   Pearson  Sample Assessment Material for first teaching September 2015
# Never the bare word: biology questions are full of specimens. And never a
# date: a specimen's cover can name its first assessment ("June 2017"), and
# OCR's schemes print when they were last revised ("February 2026"), which is
# how a specimen once came out as a March 2026 sitting. Checked with the spaces
# squashed out, because the layout pass prints "S            PECIMEN".
SAMPLE = re.compile(r"SPECIMENMATERIAL|MARKSCHEME[^\n]*(?:SPECIMEN|Specimen)"
                    r"|Sample(?:QuestionPaper|AssessmentMaterial)|SAMPLEMARKSCHEME")


def sitting(text):
    """(series, year) as printed on the paper, or (None, None) if it never says."""
    m = SESSION.search(text) or SESSION_SQUASHED.search(re.sub(r"\s+", "", text))
    if m:
        return SITTING[m.group(1).lower()], m.group(2)
    aqa = AQA_SITTING.search(text)
    if aqa:
        return aqa.group(1).lower(), f"20{aqa.group(2)}"
    cambridge = CAMBRIDGE_SITTING.search(text)
    if cambridge:
        return CAMBRIDGE_SERIES[cambridge.group(1)], f"20{cambridge.group(2)}"
    pub = PUBLICATION.search(text)
    if pub and int(pub.group(2)) in PUBLICATION_SITTING:
        return PUBLICATION_SITTING[int(pub.group(2))], f"20{pub.group(1)}"
    return None, None


# A mark scheme announces itself; a question paper instructs the candidate.
MS_MARKERS = ["Mark Scheme", "MARK SCHEME", "Mark scheme", "mark scheme",
              "General Marking Guidance", "Answer/Indicative content"]
QP_MARKERS = ["Answer all questions", "Answer ALL questions",
              "Do not write outside the box", "You must have",
              "Time allowed", "Materials"]


# An exam paper is a few hundred KB to a few MB. Anything far outside that is a
# textbook or a lecture deck, and opening it costs seconds we do not need to spend.
MAX_BYTES = 15 * 1024 * 1024


def read(path, max_pages=14):
    """Read page by page, stopping as soon as the paper identifies itself.

    A question paper says what it is on page one. A mark scheme can open with
    half a dozen pages of marking guidance and corporate boilerplate first, so a
    fixed shallow read finds the question papers and silently orphans their
    schemes — which looks exactly like a missing download.
    """
    if path.stat().st_size > MAX_BYTES:
        return None
    try:
        reader = PdfReader(path)
    except Exception:
        return None
    pages = reader.pages[:max_pages]
    out = []
    for page in pages:
        out.append(extract(page, "layout"))
        if len(out) >= 3 and match_spec("\n".join(out)):
            return "\n".join(out)
    # Some PDFs' layout pass drops text outright — a Cambridge paper can lose its
    # cover and every footer, which is where its code is printed — so read the
    # plain text too before calling a paper unidentifiable.
    return "\n".join(out + [extract(page, "plain") for page in pages])


def extract(page, mode):
    try:
        return page.extract_text(extraction_mode=mode) or ""
    except Exception:
        return ""


def match_spec(text, specs=SPECS):
    for pattern, (board, subject, level) in specs.items():
        m = re.search(pattern, text)
        if m:
            groups = m.groups()
            # "3B C" is the 3BC option paper: the space is the cover's layout
            return (board, subject, level, groups[0],
                    groups[1].replace(" ", "") if len(groups) > 1 else "")
    return None


def unshift(text):
    """Undo the broken font some Cambridge papers are set in.

    Its characters come out 29 places early — "7KLV" for "This", "9701/11"
    below the printable range altogether — so the code on the cover and in every
    footer is there but unreadable. The shifted space is "\\x03", which real text
    never holds, so a line with one in it is in that font: shift it back.
    """
    return "\n".join(
        "".join(chr(ord(c) + 29) if 0 < ord(c) < 0x5E and c != " " else c for c in line)
        if "\x03" in line else line
        for line in text.split("\n"))


def identify(path):
    text = read(path)
    if not text:
        return None
    spec = match_spec(text)
    if not spec:
        # Only an A-level code counts when read this way: no GCSE paper was
        # ever identified like this, and none may start now.
        text = unshift(text)
        spec = match_spec(text, ALEVEL_SPECS)
    if not spec:
        return None

    # The session date is on a question paper's cover but often nowhere near the
    # front of its mark scheme, so fall back in order of reliability: the stated
    # session, then Edexcel's publications code (1PH0_1F_1806_MS — YYMM), then
    # the filename. Getting this wrong un-pairs a paper from its own scheme.
    board, subject, level, paper, tier = spec
    series, year = sitting(text)
    if not series and level == "alevel" and board == "cambridge":
        cover = CAMBRIDGE_COVER_SQUASHED.search(re.sub(r"\s+", "", text))
        if cover:
            series, year = SITTING[cover.group(1).lower()], cover.group(2)
    if not year:
        pub = PUBLICATION.search(text)
        named = re.search(r"\b(20[0-2]\d)\b", path.name)
        year = f"20{pub.group(1)}" if pub else (named.group(1) if named else "unknown")

    squashed = re.sub(r"[ \t]+", "", text)
    if level == "alevel" and SAMPLE.search(squashed):
        series, year = "sample", "unknown"

    ms_hits = sum(text.count(m) for m in MS_MARKERS)
    qp_hits = sum(text.count(m) for m in QP_MARKERS)
    kind = "MS" if ms_hits > qp_hits else "QP"

    if kind == "MS" and level == "alevel":
        # Kept as P + digits + whatever letters were printed: "P65463" when none
        loose = PEARSON_LOG_LOOSE.search(squashed)
        log = f"P{loose.group(1)}{loose.group(2) or ''}" if loose else None
    else:
        found = (PEARSON_LOG if kind == "MS" else PEARSON_PAPER).search(text)
        log = found.group(1) if found else None
    return {
        "kind": kind, "board": board, "subject": subject, "level": level,
        "year": year, "series": series, "paper": paper, "tier": tier,
        "log": log,
        "confidence": abs(ms_hits - qp_hits),
    }


def stem(info):
    return (f"{info['board']}-{info['subject']}-{info['level']}-{info['year']}-"
            f"{info['series'] or 'unknown'}-p{info['paper']}{info['tier']}")


def same_paper(a, b):
    """Everything in the name but the sitting, and the year where one side lacks it."""
    return (all(a[k] == b[k] for k in ("board", "subject", "level", "paper", "tier"))
            and (a["year"] == b["year"] or "unknown" in (a["year"], b["year"])))


def borrow_sittings(found):
    """Give a Pearson question paper the sitting of the scheme that names it.

    Only a mark scheme that prints this paper's own number counts. A scheme that
    merely shares its board, subject and year could be January's or June's, and
    choosing between them is exactly the guess the sitting exists to prevent.
    GCSE papers borrow only when they print no date at all, as they always have.
    """
    schemes = {info["log"]: info for _, info in found if info["kind"] == "MS" and info["log"]}
    for _, info in found:
        if info["level"] == "alevel" and info["kind"] == "QP" and info["log"]:
            # An A-level paper takes the scheme's sitting even where it prints
            # its own: a paper set for June and sat in the autumn, as 2020's
            # were, still carries the June date, and only its scheme says when
            # it was sat. That is READING.md's rule, and the log number is the
            # proof it asks for that this is the paper's own scheme. Pearson's
            # 2020 schemes print no log number, so those papers stay unpaired:
            # sharing a subject, paper and year is not that proof.
            scheme = scheme_naming(info, found)
            if scheme and scheme["series"]:
                info["series"], info["year"] = scheme["series"], scheme["year"]
            continue
        scheme = schemes.get(info["log"]) if info["kind"] == "QP" else None
        if scheme and not info["series"] and scheme["series"]:
            info["series"] = scheme["series"]
            if info["year"] == "unknown":
                info["year"] = scheme["year"]


def scheme_naming(paper, found):
    """The one A-level mark scheme that names this question paper, or None.

    The five digits of a log number are the paper. A scheme that prints the
    letters too must print this paper's letters; one that leaves them off could
    mean any paper with those digits (P52288A has a P52288EA insert), so it
    counts only when this is the one paper here that has them. Two schemes
    naming one paper is a contradiction, not a choice, and so is a scheme for
    another subject or paper number: no sitting is taken from either.
    """
    digits, letters = paper["log"][:6], paper["log"][6:]
    papers = [p for _, p in found if p["kind"] == "QP" and (p["log"] or "")[:6] == digits]
    schemes = [s for _, s in found
               if s["kind"] == "MS" and s["level"] == "alevel" and s["log"]
               and s["log"][:6] == digits
               and (s["log"][6:] == letters or (not s["log"][6:] and len(papers) == 1))]
    if len(schemes) == 1 and same_paper(schemes[0], paper):
        return schemes[0]
    return None


def main(src_dir, apply, out_dir):
    src = pathlib.Path(src_dir).expanduser()
    pdfs = sorted(p for p in src.iterdir() if p.suffix.lower() == ".pdf")
    if not pdfs:
        sys.exit(f"No PDFs in {src}")

    print(f"Scanning {len(pdfs)} PDFs in {src}", flush=True)
    identified, skipped = [], []
    for i, p in enumerate(pdfs, 1):
        print(f"\r  {i}/{len(pdfs)}", end="", flush=True)
        info = identify(p)
        if not info:
            skipped.append(p.name)
            continue
        identified.append((p, info))

    borrow_sittings(identified)
    found, undated, claims = {}, [], collections.defaultdict(list)
    for p, info in identified:
        # A paper that never says when it was sat is not paired on the rest of
        # its name alone: January's and June's copies of it look identical.
        if not info["series"]:
            undated.append((p, info))
            continue
        claim = claims[(stem(info), info["kind"])]
        # A byte-for-byte copy ("June 2018 MS.pdf" beside PMT's longer name for
        # it) is one paper downloaded twice, not two papers
        if not any(filecmp.cmp(p, other, shallow=False) for other in claim):
            claim.append(p)
        found.setdefault(stem(info), {})[info["kind"]] = (p, info)

    # Two different files answering to one name means one of them was misread,
    # and the last one in would quietly win — which is how an AQA 3BC scheme once
    # became Section A's. None of that paper is paired until someone has looked.
    clashes = {key: paths for key, paths in claims.items() if len(paths) > 1}
    for name, _ in list(clashes):
        for kind, (path, _) in found.pop(name, {}).items():
            if (name, kind) not in clashes:
                clashes[(name, kind)] = [path]   # the other half waits with them

    print("\r" + " " * 24 + "\r", end="")
    pairs, orphans = [], []
    for name, halves in sorted(found.items()):
        if "QP" in halves and "MS" in halves:
            pairs.append((name, halves))
        else:
            orphans.append((name, halves))

    print(f"{'PAIRED':8} {'NEW NAME':50}  FROM")
    print("-" * 96)
    for name, halves in pairs:
        for kind in ("QP", "MS"):
            path, info = halves[kind]
            print(f"{'':8} {name + '-' + kind + '.pdf':50}  {path.name}")

    if orphans:
        print("\nUNPAIRED — the other half is missing, or dates a different sitting")
        print("-" * 96)
        for name, halves in orphans:
            for kind, (path, _) in halves.items():
                print(f"  {name}-{kind}  (have {kind} only)   from {path.name}")

    if clashes:
        print("\nCLAIMED TWICE — more than one file reads as the same paper, none of it paired")
        print("-" * 96)
        for (name, kind), paths in sorted(clashes.items()):
            print(f"  {name}-{kind}   from {', '.join(p.name for p in paths)}")

    if undated:
        print(f"\nSITTING UNKNOWN ({len(undated)}) — the paper never says when it was sat, left alone")
        print("-" * 96)
        for path, info in undated:
            # What the other half says is a lead for whoever checks the paper,
            # not an answer: that other sitting's own half may simply be missing.
            others = sorted({o["series"] for _, o in identified
                             if o["kind"] != info["kind"] and o["series"]
                             and same_paper(o, info)})
            hint = f"   (the {'scheme' if info['kind'] == 'QP' else 'paper'} here says {', '.join(others)})" if others else ""
            print(f"  {stem(info)}-{info['kind']}   from {path.name}{hint}")

    if skipped:
        print(f"\nCOULD NOT IDENTIFY ({len(skipped)}) — no specification code found, left alone")
        for n in skipped[:15]:
            print(f"  {n}")
        if len(skipped) > 15:
            print(f"  ... and {len(skipped) - 15} more")

    print(f"\n  {len(pairs)} complete pairs, {len(orphans)} unpaired, "
          f"{len(undated)} with no sitting, {len(skipped)} unidentified"
          + (f", {len({name for name, _ in clashes})} claimed twice" if clashes else ""))

    if not apply:
        print(f"\n  Dry run. Re-run with --apply to copy the pairs into {out_dir}/")
        return

    dest = pathlib.Path(out_dir).expanduser()
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for name, halves in pairs:
        for kind in ("QP", "MS"):
            path, _ = halves[kind]
            shutil.copy2(path, dest / f"{name}-{kind}.pdf")
            n += 1
    print(f"\n  Copied {n} files into {dest}. Originals untouched.")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    out = "papers/named"
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
    main(args[0], "--apply" in sys.argv, out)
