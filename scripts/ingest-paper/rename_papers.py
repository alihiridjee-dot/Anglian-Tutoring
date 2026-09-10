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

    edexcel-physics-gcse-2018-p1F-QP.pdf

    python3 rename_papers.py ~/Downloads              # show what it would do
    python3 rename_papers.py ~/Downloads --apply      # copy into ./papers/
    python3 rename_papers.py ~/Downloads --apply --out /some/dir

Copies rather than moves, so the originals stay where they are and a wrong
guess costs nothing. Files it cannot identify are listed and left alone —
never guessed at, because a mis-paired mark scheme is silent corruption.
"""
import re
import sys
import shutil
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

_CODES = [
    # AQA GCSE — tier F or H
    ("8461", "aqa", "biology", "gcse", "[FH]"),
    ("8462", "aqa", "chemistry", "gcse", "[FH]"),
    ("8463", "aqa", "physics", "gcse", "[FH]"),
    ("8464", "aqa", "combined-trilogy", "gcse", "[FH]"),
    ("8465", "aqa", "combined-synergy", "gcse", "[FH]"),
    # Pearson Edexcel GCSE
    ("1BI0", "edexcel", "biology", "gcse", "[FH]"),
    ("1CH0", "edexcel", "chemistry", "gcse", "[FH]"),
    ("1PH0", "edexcel", "physics", "gcse", "[FH]"),
    ("1SC0", "edexcel", "combined", "gcse", "[FH]"),
    # Pearson Edexcel International GCSE — C (core) or R (extension)
    ("4BI1", "edexcel", "biology", "igcse", "[CR]"),
    ("4CH1", "edexcel", "chemistry", "igcse", "[CR]"),
    ("4PH1", "edexcel", "physics", "igcse", "[CR]"),
    # OCR Gateway A — no tier in the code, papers are 01/02
    ("J247", "ocr", "biology", "gcse", ""),
    ("J248", "ocr", "chemistry", "gcse", ""),
    ("J249", "ocr", "physics", "gcse", ""),
    ("J250", "ocr", "combined", "gcse", ""),
]

SPECS = {
    (rf"\b{code}{SEP}0?([1-9]){SEP}({tier})" if tier else rf"\b{code}{SEP}0([1-9])\b"):
        (board, subject, level)
    for code, board, subject, level, tier in _CODES
}

SESSION = re.compile(r"\b(January|June|November|May|October)\s+(20\d\d)\b", re.I)

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
    out = []
    for page in reader.pages[:max_pages]:
        try:
            out.append(page.extract_text(extraction_mode="layout") or "")
        except Exception:
            continue
        if len(out) >= 3 and match_spec("\n".join(out)):
            break
    return "\n".join(out)


def match_spec(text):
    for pattern, (board, subject, level) in SPECS.items():
        m = re.search(pattern, text)
        if m:
            groups = m.groups()
            return (board, subject, level, groups[0],
                    groups[1] if len(groups) > 1 else "")
    return None


def identify(path):
    text = read(path)
    if not text:
        return None
    spec = match_spec(text)
    if not spec:
        return None

    # The session date is on a question paper's cover but often nowhere near the
    # front of its mark scheme, so fall back in order of reliability: the stated
    # session, then Edexcel's publications code (1PH0_1F_1806_MS — YYMM), then
    # the filename. Getting this wrong un-pairs a paper from its own scheme.
    session = SESSION.search(text)
    if session:
        year, month = session.group(2), session.group(1).lower()[:3]
    else:
        pub = re.search(r"_([0-9]{2})(0[1-9]|1[0-2])_", text)
        named = re.search(r"\b(20[0-2]\d)\b", path.name)
        year = f"20{pub.group(1)}" if pub else (named.group(1) if named else "unknown")
        month = ""

    ms_hits = sum(text.count(m) for m in MS_MARKERS)
    qp_hits = sum(text.count(m) for m in QP_MARKERS)
    kind = "MS" if ms_hits > qp_hits else "QP"

    board, subject, level, paper, tier = spec
    return {
        "kind": kind, "board": board, "subject": subject, "level": level,
        "year": year, "month": month, "paper": paper, "tier": tier,
        "stem": f"{board}-{subject}-{level}-{year}-p{paper}{tier}",
        "confidence": abs(ms_hits - qp_hits),
    }


def main(src_dir, apply, out_dir):
    src = pathlib.Path(src_dir).expanduser()
    pdfs = sorted(p for p in src.iterdir() if p.suffix.lower() == ".pdf")
    if not pdfs:
        sys.exit(f"No PDFs in {src}")

    print(f"Scanning {len(pdfs)} PDFs in {src}", flush=True)
    found, skipped = {}, []
    for i, p in enumerate(pdfs, 1):
        print(f"\r  {i}/{len(pdfs)}", end="", flush=True)
        info = identify(p)
        if not info:
            skipped.append(p.name)
            continue
        found.setdefault(info["stem"], {})[info["kind"]] = (p, info)

    print("\r" + " " * 24 + "\r", end="")
    pairs, orphans = [], []
    for stem, halves in sorted(found.items()):
        if "QP" in halves and "MS" in halves:
            pairs.append((stem, halves))
        else:
            orphans.append((stem, halves))

    print(f"{'PAIRED':8} {'NEW NAME':46}  FROM")
    print("-" * 92)
    for stem, halves in pairs:
        for kind in ("QP", "MS"):
            path, info = halves[kind]
            print(f"{'':8} {stem + '-' + kind + '.pdf':46}  {path.name}")

    if orphans:
        print(f"\n{'UNPAIRED — the other half is missing':<46}")
        print("-" * 92)
        for stem, halves in orphans:
            for kind, (path, _) in halves.items():
                print(f"  {stem}-{kind}  (have {kind} only)   from {path.name}")

    if skipped:
        print(f"\nCOULD NOT IDENTIFY ({len(skipped)}) — no specification code found, left alone")
        for n in skipped[:15]:
            print(f"  {n}")
        if len(skipped) > 15:
            print(f"  ... and {len(skipped) - 15} more")

    print(f"\n  {len(pairs)} complete pairs, {len(orphans)} unpaired, {len(skipped)} unidentified")

    if not apply:
        print("\n  Dry run. Re-run with --apply to copy the pairs into ./papers/")
        return

    dest = pathlib.Path(out_dir).expanduser()
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for stem, halves in pairs:
        for kind in ("QP", "MS"):
            path, _ = halves[kind]
            shutil.copy2(path, dest / f"{stem}-{kind}.pdf")
            n += 1
    print(f"\n  Copied {n} files into {dest}. Originals untouched.")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    out = "papers"
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
    main(args[0], "--apply" in sys.argv, out)
