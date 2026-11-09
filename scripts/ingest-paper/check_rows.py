"""
Hold every row read from an exam paper to the page it came from.

A reader transcribing a paper can drift without noticing: a stem written to
summarise rather than copied, marks misread, a mark scheme taken from the part
beside it, a question kept that only makes sense with its graph. Each of those
is checkable against the documents, so this checks them, using the skeleton
extract_paper.py reads off the PDFs:

  - the label is a part the paper prints
  - the marks are the marks printed for that part
  - every line of the prompt, the shared stem and each option is on the page,
    inside the same question (not composed, not borrowed from elsewhere)
  - every line of the mark scheme is in that part's own scheme entry
  - a part that needs a figure is skipped, not kept as text
  - a multiple-choice answer names one of the printed options
  - every part is either a row or a skipped entry, and the marks add up
  - every spec point code exists in the course's code list

A row that fails gets a flag saying why, and the database never approves a
flagged row. Nothing here writes to the database.

    python3 check_rows.py papers/<stem>.json              # report
    python3 check_rows.py papers/<stem>.json --write      # also write the flags into the file
    python3 check_rows.py --audit papers/done             # every loaded paper, report only

The PDFs are found by the rows file's name: <stem>-QP.pdf and <stem>-MS.pdf
beside it, or in papers/named, papers/incoming or papers/done.

A reader may keep a part the extractor thinks needs a figure, when the figure
is decoration and the question stands without it. Say so on the row with
"figure_checked": "<why it is not needed>", and the check accepts it. A reader
who has put a stacked fraction or formula back in reading order from the page
says so with "page_checked": "<what was reordered>"; its words must still all
be the question's own.
"""
import collections
import csv
import difflib
import json
import pathlib
import re
import sys
import unicodedata

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract_paper as X  # noqa: E402

SCRIPTS = str.maketrans("₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻₊₋ⁿᶿ∆×ᵒº", "01234567890123456789+-+-noΔx°°")
# Greek capitals a page can set in place of the Latin letter they look like
# (AQA's nuclides print hydrogen as Eta: "Η + Η → Ηe").
LOOKALIKE = str.maketrans("ΑΒΕΗΙΚΜΝΟΡΤΧΥΖ", "ABEHIKMNOPTXYZ")


def norm(t):
    """Letters and digits only, so line breaks, spacing, scripts and
    punctuation the text layer mangles never count against a row."""
    t = unicodedata.normalize("NFKC", (t or "").translate(X.SYMBOL_PUA).translate(SCRIPTS).translate(LOOKALIKE)).lower()
    return re.sub(r"[^0-9a-zͰ-Ͽ]+", "", t)


ONLY_ANSWER = re.compile(r"\bthe only correct answer is\b|\bonly correct answer\b", re.I)
MARK = re.compile(r"\(\s*\d{1,2}\s*\)|\[\s*\d{1,2}\s*\]")


RAISED_COUNT = re.compile(r"(?:Cl|Br|Na|Mg|Ca|Al|Fe|Cu|Zn|Si|Li|Mn|Cr|Co|Ni|Ag|Pb|Ba|Sn|"
                          r"[HCNOSPIFKB])(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]{2,}(?![¹²³⁴⁵⁶⁷⁸⁹⁰⁺⁻A-Z])|[¹²³⁴⁵⁶⁷⁸⁹⁰](?![¹²³⁴⁵⁶⁷⁸⁹⁰⁺⁻]))")
# Two raised digits before an element are its mass number: Cl⁸¹Br is Cl + ⁸¹Br.


def raised_formula(text):
    """A formula with its atom counts raised: two in one formula ("C⁸H¹⁸"),
    or one beside lowered ones. A single raised letter is a power ("[S]³"),
    and a formula opening raised is a nuclide ("⁷⁹Br⁷⁹Br")."""
    for token in re.findall(r"[^\s/=×·,;:]+", text):
        if token[0] in "¹²³⁴⁵⁶⁷⁸⁹⁰":
            continue
        n = len(RAISED_COUNT.findall(token))
        if n >= 2 or (n and re.search("[₀-₉]", token)):
            return True
    return False
SCRIPT_RUN = re.compile("([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+|[₀₁₂₃₄₅₆₇₈₉₊₋]+)")


def words(t):
    # A raised or lowered run is a word of its own, so ²³⁸₉₂U, SO₄²⁻ and the
    # text layer's SO²⁻₄ compare by their numbers, whatever order they arrive in.
    # ᶿ and Σ are symbols, like ⦵; a maths font's text layer stores Σ as "Ρ" or "R".
    t = X.ITALIC_L_GAP.sub("", re.sub("[ᶿΣ×]", " ", t or ""))   # × too: Pearson stores it as \x1e
    t = SCRIPT_RUN.sub(r" \1 ", t)
    t = unicodedata.normalize("NFKC", t.translate(X.SYMBOL_PUA).translate(SCRIPTS).translate(LOOKALIKE)).lower()
    # Numbers and letters apart: "209Po" and ²⁰⁹Po both give 209, po.
    # Decimals split at the point too: the text layer can set "0.99" as "0 99".
    return collections.Counter(re.findall(r"[0-9]+|[a-z]+|[\u0370-\u03ff]+", t))


def contains(bag, piece):
    """Every word of the piece is in the bag, as often as the piece uses it."""
    need = words(piece)
    return all(bag[w] >= n for w, n in need.items())


def chunks(text, scheme=False):
    """The pieces of a row's text to look for: its lines, with a reader's
    "Guidance:" heading taken off. In a mark scheme a mark, "(1)", may sit in
    the answer or in the mark column, so marks never count either way."""
    out = []
    for line in (text or "").split("\n"):
        line = re.sub(r"^\s*Guidance:\s*", "", line)
        if scheme:
            line = re.sub(r"^\s*Answer:\s*", "", line)     # a reader's heading, like Guidance:
            line = MARK.sub(" ", line)
        for piece in re.split(r"\s+·\s+|\s*\|\s*|\t", line):
            piece = re.sub(r"^\s*\((?:[a-h]|i{1,3}|iv|vi{0,3}|ix|x)\)\s*", "", piece)
            n = norm(piece)
            if len(n) >= 6:
                out.append((piece.strip(), n))
    return out


def label_key(label):
    key = re.sub(r"[\s*]", "", str(label or ""))
    return re.sub(r"^(\d)\.(\d+)$", r"0\1.\2", key)           # AQA "1.2" is "01.2"


def papers_root(rows_path):
    """The papers/ folder the rows file lives under (worktrees keep their own)."""
    for parent in rows_path.resolve().parents:
        if parent.name == "papers":
            return parent
    return pathlib.Path("papers")


def find_pdfs(rows_path):
    stem = rows_path.name[:-len(".json")]
    root = papers_root(rows_path)
    for folder in (rows_path.parent, root / "named", root / "incoming", root / "done"):
        qp, ms = folder / f"{stem}-QP.pdf", folder / f"{stem}-MS.pdf"
        if qp.exists() and ms.exists():
            return qp, ms
    return None, None


def course_codes(rows_path, stem):
    m = re.match(r"^([a-z_]+)-([a-z-]+)-(gcse_trilogy|gcse|igcse|alevel)-", stem)
    if not m:
        return None
    path = papers_root(rows_path) / "spec-points" / f"{m.group(1)}-{m.group(2)}-{m.group(3)}.tsv"
    if not path.exists():
        return None
    with open(path) as f:
        return {r["code"] for r in csv.DictReader(f, delimiter="\t")}


def check(rows_path, x=None):
    data = json.loads(rows_path.read_text())
    qp, ms = find_pdfs(rows_path)
    if x is None:
        if not qp:
            return None, [f"{rows_path.name}: its question paper and mark scheme were not found"]
        x = X.extract(str(qp), str(ms))
    stem = rows_path.name[:-len(".json")]
    parts = {label_key(p["label"]): p for p in x["parts"]}
    by_q = collections.defaultdict(list)
    for p in x["parts"]:
        by_q[p["q"]].append(p)

    def question_text(q):
        text = []
        for p in by_q.get(str(q), []):
            text += [p.get("source", "")] + p["stems"] + [p["prompt"]] + [o["text"] for o in (p["options"] or [])]
        return norm("\n".join(text)), words("\n".join(text))

    whole_qp = norm(X.doc_text(str(qp))) if qp else ""
    whole_ms = norm(MARK.sub(" ", X.doc_text(str(ms)))) if ms else ""
    codes = course_codes(rows_path, stem)
    report = []
    seen = set()

    for row in data.get("rows", []):
        flags = []
        key = label_key(row.get("label"))
        part = parts.get(key)
        if part is None:
            flags.append("label not printed on the paper")
            report.append((row.get("label"), flags))
            row["_check"] = flags
            continue
        seen.add(key)
        if x.get("damaged_text"):
            flags.append("text layer damaged: verify against the page")
        # A private-use or control character is a symbol the font never named (⇌, ⦵…):
        # what the page shows is unknown, so it cannot stand in a row.
        texts = [row.get(f) or "" for f in ("shared_context", "prompt", "mark_scheme")] + \
            [str(o.get("text") if isinstance(o, dict) else o) for o in row.get("options") or []]
        # ...and Indic letters a broken maths font maps symbols to ("ൊ" for ÷, "ଷ").
        if any(re.search("[\ue000-\uf8ff\x00-\x08\x0b-\x1f\u0900-\u0dff]", x_) for x_ in texts):
            flags.append("unmapped symbol (private-use character) left in the text")
        # A formula's atom counts are lowered; raised after an element with no
        # charge sign ("C⁸H¹⁸", "2H²SO⁴") they were misread, and the
        # normalising below would let it through.
        if re.search(r"chemistry|biology", stem) and any(raised_formula(x_) for x_ in texts):
            flags.append("raised atom count in a formula: write it lowered as printed")
        # ...and a charge is raised: "MnO₄₋" was misread from MnO₄⁻.
        if any(re.search(r"[₀-₉A-Za-z)][₊₋](?![₀-₉])", x_) for x_ in texts):
            flags.append("lowered charge sign: write the charge raised as printed")
        if re.search(r"question\s+discounted|award the mark regardless", row.get("mark_scheme") or "", re.I):
            flags.append("the board discounted this question: skip it")
        opt_texts = [re.sub(r"\s+", " ", str(o.get("text") if isinstance(o, dict) else o)).strip()
                     for o in row.get("options") or []]
        if len([o for o in opt_texts if o]) != len({o for o in opt_texts if o}):
            flags.append("options repeat: a symbol drawn on the page is missing")
        # A ✓/✗ table's key ("✓ = can form vesicles") read into an option.
        if any(re.search(r"[✓✗]\s*=|\bkey\b", str(o.get("text") if isinstance(o, dict) else o), re.I)
               for o in row.get("options") or []):
            flags.append("option holds the table's key: move it to the prompt")
        if not (row.get("prompt") or "").strip():
            flags.append("prompt is empty: the part's own words are missing")
        if part["marks"] is not None and row.get("marks") != part["marks"]:
            flags.append(f"marks {row.get('marks')} but the paper prints {part['marks']}")
        qtext, qbag = question_text(part["q"])
        for field in ("shared_context", "prompt"):
            table_lines = {l for l in (row.get(field) or "").split("\n") if "|" in l}
            for piece, n in chunks(row.get(field)):
                if n in qtext:
                    continue
                # A table cell whose heading wraps onto a second line reads
                # across its neighbours on the page; its words must still be
                # this question's.
                # Re-laid but not rewritten: a table as rows, sentences joined,
                # a list flattened, a stacked fraction on one line. Every word
                # and number is still this question's own; new words are not.
                if contains(qbag, piece):
                    continue
                where = "from another question" if n in whole_qp else "not on the paper"
                flags.append(f"{field} {where}: “{piece[:60]}”")
        options = [o if isinstance(o, dict) else {"letter": None, "text": str(o)} for o in row.get("options") or []]
        for opt in options:
            n = norm(opt.get("text"))
            if n and n not in qtext and not contains(qbag, opt.get("text")):
                flags.append(f"option {opt.get('letter') or ''} not on the paper: “{(opt.get('text') or '')[:40]}”")
        entry = part["scheme"]
        raw_entry = MARK.sub(" ", "\n".join([entry["answer"], entry["guidance"], entry["ao"]])) if entry else ""
        etext, ebag = norm(raw_entry), words(raw_entry)
        scheme = row.get("mark_scheme")
        if not (scheme or "").strip():
            flags.append("no mark scheme")
        for piece, n in chunks(scheme, scheme=True):
            # A scheme may be put back in reading order: a stacked fraction
            # written with "/", guidance regrouped. Its words must still all
            # be this part's own.
            if n in etext or contains(ebag, piece):
                continue
            # The text layer can glue a cell's lines ("2Born-Habersimilarities"):
            # every word of three letters or more must still be inside this
            # part's own entry.
            long_words = [norm(w) for w in words(piece) if len(norm(w)) >= 3]
            if long_words and all(w in etext for w in long_words):
                continue
            if n in whole_ms:
                flags.append(f"mark scheme line belongs to another part: “{piece[:60]}”")
            else:
                flags.append(f"mark scheme line not in the mark scheme: “{piece[:60]}”")
        if part["needs_figure"] and not row.get("figure_checked"):
            flags.append("needs image")
            flags.append("needs a figure: " + "; ".join(part["figure_reasons"])[:120])
        if options:
            letters = {o.get("letter") for o in options if o.get("letter")}
            named = set(re.findall(r"\b([A-J])\b", scheme or ""))
            texts = [norm(o.get("text")) for o in options if norm(o.get("text"))]
            ns = norm(scheme)

            def quotes(x):
                # AQA's key can quote a tick-box option without its first
                # words ("forms a solution with pH = 14" for "It forms…").
                m = difflib.SequenceMatcher(None, x, ns).find_longest_match(0, len(x), 0, len(ns))
                return x in ns or m.size >= min(12, len(x))
            if not (named & letters or any(quotes(x) for x in texts)):
                flags.append("multiple-choice answer names no printed option")
        # A one-mark answer that is a bare letter (AQA's key: "C") is a choice too.
        letter_key = row.get("marks") == 1 and re.match(r"^\s*[A-H](?:\s|$)", scheme or "") \
            and not re.match(r"^\s*[A-H]\s+[a-z]", scheme or "") \
            and not re.match(r"^\s*[A-H]\s*=", scheme or "")       # "F = 9.2 + 12 – 13": a quantity, not a choice
        # A reader's "letter_checked" says the letter is an answer in its own right
        # (a spectral class "B", a point on a graph), not a choice.
        if not options and (ONLY_ANSWER.search(scheme or "") or (letter_key and not row.get("letter_checked"))):
            flags.append("the scheme names one correct option but the row has no options")
        if codes is not None:
            unknown = [c for c in row.get("spec_points") or [] if c not in codes]
            if unknown:
                flags.append("unknown spec point codes: " + ", ".join(unknown))
        row["_check"] = flags
        report.append((row.get("label"), flags))

    # Coverage: every printed part is a row or a skipped entry.
    skipped = {label_key(s.get("label")) for s in data.get("skipped", [])}
    missing = [p["label"] for p in x["parts"] if label_key(p["label"]) not in seen | skipped]
    row_marks = sum((r.get("marks") or 0) for r in data.get("rows", []) if label_key(r.get("label")) in parts)
    skip_marks = sum((s.get("marks") or 0) for s in data.get("skipped", []))
    alternatives = sum(p["marks"] or 0 for p in x["parts"] if p.get("alternative")) - \
        max([p["marks"] or 0 for p in x["parts"] if p.get("alternative")] or [0])
    paper = []
    if missing:
        paper.append(f"parts neither read nor skipped: {', '.join(missing)}")
    if x["paper_total"] and row_marks + skip_marks - alternatives != x["paper_total"]:
        paper.append(f"rows {row_marks} + skipped {skip_marks} marks ≠ the paper's {x['paper_total']}")
    return data, report, paper


def apply_flags(data):
    """Write the check's findings into each row's flags. The check's own flags
    replace those it wrote last time; a reader's flags stay."""
    for row in data.get("rows", []):
        found = row.pop("_check", [])
        kept = [f for f in row.get("flags", []) if not f.startswith(CHECK_PREFIXES)]
        row["flags"] = kept + [f for f in found if f not in kept]


CHECK_PREFIXES = ("label not printed", "text layer damaged", "marks ", "shared_context ", "prompt ",
                  "option ", "no mark scheme", "mark scheme line", "needs image", "needs a figure",
                  "multiple-choice answer", "unknown spec point", "the scheme names one correct option",
                  "unmapped symbol", "raised atom count", "prompt is empty", "the board discounted", "options repeat", "lowered charge sign")


def summarise(path, report, paper):
    flagged = [(l, f) for l, f in report if f]
    print(f"{path}: {len(report)} rows, {len(report) - len(flagged)} clean, {len(flagged)} flagged")
    for line in paper:
        print(f"  ! {line}")
    for label, flags in flagged:
        print(f"  {label}: " + " | ".join(flags))


def audit(folder):
    """Every rows file in a folder, against its PDFs. Report only."""
    folder = pathlib.Path(folder)
    out = csv.writer(sys.stdout, delimiter="\t")
    out.writerow(["paper", "label", "problem"])
    totals = collections.Counter()
    for path in sorted(folder.glob("*.json")):
        try:
            result = check(path)
        except Exception as e:                       # a paper the extractor cannot read
            out.writerow([path.stem, "", f"could not check: {e!r}"[:200]])
            totals["unreadable"] += 1
            continue
        if result[0] is None:
            totals["no pdfs"] += 1
            continue
        _, report, paper = result
        totals["papers"] += 1
        for line in paper:
            out.writerow([path.stem, "", line])
        for label, flags in report:
            totals["rows"] += 1
            totals["flagged rows"] += bool(flags)
            for f in flags:
                out.writerow([path.stem, label, f])
                totals[re.split(r"[:“(]", f)[0].strip()[:40]] += 1
    print("\n# " + json.dumps(dict(totals.most_common()), ensure_ascii=False), file=sys.stderr)


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "--audit":
        audit(args[1] if len(args) > 1 else "papers/done")
        sys.exit()
    for a in [a for a in args if not a.startswith("--")]:
        path = pathlib.Path(a)
        result = check(path)
        if result[0] is None:
            print(result[1][0])
            continue
        data, report, paper = result
        summarise(path, report, paper)
        if "--write" in args:
            apply_flags(data)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
            print(f"  flags written to {path}")
