"""
Read an exam question paper and its mark scheme into a checked skeleton.

split_paper.py hands a reader the raw text layer and trusts the reader for the
rest: where a question starts, how many marks it carries, whether it leans on a
figure, which lines of the mark scheme belong to it. Each of those is a fact the
page states, so this reads them off the page instead, from PyMuPDF's spans and
drawings rather than pypdf's layout text:

  - words stay whole, and sub/superscripts survive (CaCO₃, 10⁻⁷, Fe³⁺), because
    each span's size and baseline say what it is
  - every question part is found by its printed label, in order, with the marks
    printed beside it, so the skeleton reconciles against the paper's own totals
  - every part owns the stretch of page from its label to the next one, so a
    picture, a drawn graph, a structure or a tick box inside it is detected
    rather than guessed
  - the mark scheme is split into its columns by the table's own rules, so the
    answer, the examiner guidance and the mark never interleave, and each entry
    is keyed to the part it marks

    python3 extract_paper.py QP.pdf MS.pdf            # report: what was found, what reconciles
    python3 extract_paper.py QP.pdf MS.pdf --json     # the skeleton, for check_rows.py
    python3 extract_paper.py QP.pdf MS.pdf --draft    # draft rows in the READING.md shape
    python3 extract_paper.py QP.pdf MS.pdf --text     # clean text of both, for a reader

Draft rows are verbatim by construction: every prompt and scheme is the page's
own text, cut at the page's own labels. A reader still decides what the shared
stem is, checks what was set aside as needing a figure, and tags each row;
check_rows.py then holds every row to the page.

Nothing here writes to the database.
"""
import collections
import json
import re
import sys

import pymupdf

# --------------------------------------------------------------------------
# Boards. The specification code printed on the paper says which one it is.
# --------------------------------------------------------------------------

SPEC_CODE = re.compile(
    r"\b(846[1-5]|740[1-8]|920[1-3]|1(?:BI|CH|PH|SC)0|4(?:BI|CH|PH)1|[89](?:BN|BI|CH|PH)0"
    r"|J2(?:4[789]|50)|H(?:0[235][06]|420|432|556)|06(?:10|20|25)|970[0-2])\b")


def board_of(spec):
    if spec is None:
        return None
    if re.match(r"84|74|92", spec):
        return "aqa"
    if re.match(r"[1489](?:BI|CH|PH|BN|SC)", spec):
        return "edexcel"
    if re.match(r"[JH]\d", spec):
        return "ocr"
    return "cambridge"


# A part's marks, printed at the right-hand edge. OCR and Cambridge print them
# at the end of the last answer line, so they are read off the end of a cell.
MARK_TOKEN = {
    "aqa": re.compile(r"\[\s*(\d+)\s*marks?\s*\]\s*$", re.I),
    "edexcel": re.compile(r"^\(\s*(\d+)\s*\)$"),
    "ocr": re.compile(r"(?:^|(?<=[\s.…]))\[\s*(\d+)\s*\]\s*$"),
    "cambridge": re.compile(r"(?:^|(?<=[\s.…]))\[\s*(\d+)\s*\]\s*$"),
}
EDEXCEL_TOTAL = re.compile(r"^\(?\s*Total\s+for\s+Question\s+(\d+)\s*=\s*(\d+)\s*marks?\s*\)?$", re.I)
CAMBRIDGE_TOTAL = re.compile(r"\[\s*Total\s*:\s*(\d+)\s*\]\s*$", re.I)
ONE_MARK_EACH = re.compile(r"Each correct answer will score one mark", re.I)
PAPER_TOTAL = re.compile(
    r"(?:total|maximum)\s+marks?\s+for\s+this\s+paper\s+is\s+(\d+)"
    r"|total\s+mark\s+for\s+this\s+paper\s+is\s+(\d+)", re.I)

# --------------------------------------------------------------------------
# Text: spans into visual lines, with sub/superscripts kept.
# --------------------------------------------------------------------------

SUP = str.maketrans("0123456789+-–−=()n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁻⁼⁽⁾ⁿ")
SUB = str.maketrans("0123456789+-–−=()", "₀₁₂₃₄₅₆₇₈₉₊₋₋₋₌₍₎")
SUP_OK = set("0123456789+-–−=()n")
SUB_OK = set("0123456789+-–−=()")
# The standard-state symbol is set as a raised o or θ; the spec text in this
# project writes it ᶿ (ΔHᶿ, Eᶿ).
STANDARD = {"o", "θ", "⦵", "O", "⊖"}

# Barcode and font-encoding debris: Cambridge prints a strip of glyphs that
# decode to Latin Extended-A noise.
DEBRIS = re.compile(r"[Ā-ſ]{4,}")

MAIN = {}                      # (document, page) -> reading direction
LINE_BANDS = {}                # (document, page) -> [(u0, u1, v0, v1)] of its text lines
MARGIN_NOTE = re.compile(r"^(?:Do not write|outside the|box|outside the box|Do not write outside the box)$", re.I)


class Span:
    __slots__ = ("text", "size", "bold", "u0", "u1", "v0", "v1", "base")

    def __init__(self, text, size, bold, u0, u1, v0, v1, base, font=""):
        self.text, self.size, self.bold = glyphs(text, font), size, bold
        self.u0, self.u1, self.v0, self.v1, self.base = u0, u1, v0, v1, base


class Line:
    """One visual line: spans sharing a baseline band, in reading order.

    `cells` keeps runs separated by a wide gap apart, because on these pages a
    wide gap is structure: label | text | marks, or a table's columns.
    """

    def __init__(self, page, spans):
        self.page = page
        self.spans = sorted(spans, key=lambda s: s.u0)
        main = max(self.spans, key=lambda s: (s.size, s.u1 - s.u0))
        self.size, self.base = main.size, main.base
        self.v0 = min(s.v0 for s in self.spans if s.size >= 0.86 * self.size)
        self.v1 = max(s.v1 for s in self.spans if s.size >= 0.86 * self.size)
        self.u0 = self.spans[0].u0
        self.u1 = max(s.u1 for s in self.spans)
        self.cells = self._cells()
        self.text = "\t".join(c[2] for c in self.cells)

    def _cells(self, spans=None, split=True):
        cells, cur, cu0, cu1, prev = [], "", None, None, None
        for s in (self.spans if spans is None else spans):
            t = self._script(s)
            if prev is None:
                cur, cu0, cu1 = t, s.u0, s.u1
            else:
                gap = s.u0 - prev.u1
                if split and gap > 2.2 * self.size:
                    cells.append((cu0, cu1, tidy(cur)))
                    cur, cu0 = t, s.u0
                elif gap > (0.5 if t != s.text else 0.12) * self.size and not cur.endswith(" ") \
                        and not t.startswith(" "):
                    # A raised or lowered script joins the text it sits against.
                    cur += " " + t
                else:
                    cur += t
                cu1 = max(cu1, s.u1)
            prev = s
        if prev is not None:
            cells.append((cu0, cu1, tidy(cur)))
        return [c for c in cells if c[2]]

    def columns(self, cols):
        """This line's text per table column, split span by span, so a label
        and the answer beside it never share a cell."""
        by = collections.defaultdict(list)
        for s in self.spans:
            by[column_of(cols, s.u0)].append(s)
        return {name: " ".join(c[2] for c in self._cells(spans)) for name, spans in by.items()}

    def _script(self, s):
        text = s.text
        if s.size > 0.86 * self.size or not text.strip():
            return text
        shift = s.base - self.base
        if abs(shift) < 0.08 * self.size:
            return text
        raw = text.strip()
        if shift > 0:                                   # below the baseline
            return raw.translate(SUB) if set(raw) <= SUB_OK else "_" + raw
        if raw in STANDARD:                             # above the baseline
            # ...except the blood-group allele Iᵒ, whose raised o follows an I.
            before = [x for x in self.spans if x.u1 <= s.u0 + 0.5 and x is not s]
            if before and max(before, key=lambda x: x.u1).text.rstrip().endswith("I"):
                return "ᵒ"
            return "ᶿ"
        if raw in ("st", "nd", "rd", "th"):             # 2nd, 3rd: read plain
            return raw
        return raw.translate(SUP) if set(raw) <= SUP_OK else "^" + raw


# Characters set in the Symbol font arrive in the private-use area, U+F020 to
# U+F0FF in Symbol's own encoding: Δ as U+F044, × as U+F0B4.
SYMBOL = {
    0x20: " ", 0x21: "!", 0x22: "∀", 0x23: "#", 0x24: "∃", 0x25: "%", 0x26: "&", 0x27: "∋", 0x28: "(",
    0x29: ")", 0x2A: "∗", 0x2B: "+", 0x2C: ",", 0x2D: "−", 0x2E: ".", 0x2F: "/", 0x3A: ":", 0x3B: ";",
    0x3C: "<", 0x3D: "=", 0x3E: ">", 0x3F: "?", 0x40: "≅", 0x41: "Α", 0x42: "Β", 0x43: "Χ", 0x44: "Δ",
    0x45: "Ε", 0x46: "Φ", 0x47: "Γ", 0x48: "Η", 0x49: "Ι", 0x4B: "Κ", 0x4C: "Λ", 0x4D: "Μ", 0x4E: "Ν",
    0x4F: "Ο", 0x50: "Π", 0x51: "Θ", 0x52: "Ρ", 0x53: "Σ", 0x54: "Τ", 0x55: "Υ", 0x57: "Ω", 0x58: "Ξ",
    0x59: "Ψ", 0x5A: "Ζ", 0x5B: "[", 0x5C: "∴", 0x5D: "]", 0x5E: "⊥", 0x5F: "_", 0x61: "α", 0x62: "β",
    0x63: "χ", 0x64: "δ", 0x65: "ε", 0x66: "φ", 0x67: "γ", 0x68: "η", 0x69: "ι", 0x6A: "ϕ", 0x6B: "κ",
    0x6C: "λ", 0x6D: "μ", 0x6E: "ν", 0x6F: "ο", 0x70: "π", 0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ",
    0x75: "υ", 0x76: "ϖ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7A: "ζ", 0x7B: "{", 0x7C: "|", 0x7D: "}",
    0x7E: "∼", 0xA2: "′", 0xA3: "≤", 0xA5: "∞", 0xAB: "↔", 0xAC: "←", 0xAD: "↑", 0xAE: "→", 0xAF: "↓",
    0xB0: "°", 0xB1: "±", 0xB2: "″", 0xB3: "≥", 0xB4: "×", 0xB5: "∝", 0xB6: "∂", 0xB7: "•", 0xB8: "÷",
    0xB9: "≠", 0xBA: "≡", 0xBB: "≈", 0xBC: "…", 0xC5: "⊕", 0xC6: "∅", 0xC7: "∩", 0xC8: "∪", 0xD6: "√",
    0xD7: "⋅", 0xD8: "¬", 0xD9: "∧", 0xDA: "∨", 0xDB: "⇔", 0xDC: "⇐", 0xDD: "⇑", 0xDE: "⇒", 0xDF: "⇓",
    0xE5: "∑", 0xF2: "∫",
}
SYMBOL_PUA = {0xF000 + k: v for k, v in SYMBOL.items()}
# Mark schemes tick their marking points in a dingbat font. The same code means
# a different glyph in each, so the font decides: Wingdings ü and Wingdings 2
# P are both ✓, ZapfDingbats 3 is ✓ too.
DINGBATS = {
    "wingdings 2": {0x50: "✓", 0x4F: "✗", 0x51: "✗", 0x52: "☑", 0x53: "☒", 0x54: "☒", 0xA3: "☐"},
    "wingdings": {0xFC: "✓", 0xFB: "✗", 0xFD: "☒", 0xFE: "☑", 0xA8: "☐", 0x6F: "☐", 0x9F: "•",
                  0xA7: "▪", 0xD8: "➢", 0xE0: "→", 0xE8: "→", 0xF0: "⇨", 0x77: "◆"},
    "zapfdingbats": {0x33: "✓", 0x34: "✔", 0x37: "✗", 0x38: "✘", 0x6E: "■", 0x6C: "●"},
}


def glyphs(text, font):
    """Text with symbol-font characters mapped to what is printed."""
    f = font.lower().replace("-", " ").replace("+", " ")
    # Pearson sets reaction arrows as a lone "o" in SymbolMT and the
    # equilibrium sign as "U" in MathType's Euclid Extra.
    if "symbol" in f and text.strip() == "o":
        return text.replace("o", "→")
    if "euclidextra" in f.replace(" ", "") and text.strip() == "U":
        return text.replace("U", "⇌")
    if "euclidextra" in f.replace(" ", "") and text.strip() == "d":
        return text.replace("d", "ᶿ")                     # Pearson's standard-state sign
    # MathType's Greek fonts (OCR's MMaGreek) set Greek on Latin codes, as
    # Symbol does, and χ on "|".
    # MathType's relation and operator fonts set ≥, < and ∝ on other codes.
    # Cambridge's table ticks and crosses: Monotype Sorts on control codes.
    if "monotypesorts" in f.replace(" ", ""):
        return text.translate(str.maketrans({"\x16": "✓", "\x1a": "✗"}))
    if "relation" in f:
        return text.translate(str.maketrans({"H": "≥", "1": "<"}))
    if "binary" in f:
        return text.replace("\\", "∝")
    if "greek" in f:
        return "".join("χ" if ch == "|" else SYMBOL.get(ord(ch), ch) if ch.isascii() and ch.isalpha() else ch
                       for ch in text)
    for name in ("wingdings 2", "wingdings2", "wingdings", "zapfdingbats", "dingbats"):
        if name in f:
            table = DINGBATS["wingdings 2" if "2" in name else "zapfdingbats" if "dingbats" in name else "wingdings"]
            out = []
            for ch in text:
                c = ord(ch)
                out.append(table.get(c & 0xFF if c >= 0xF000 else c, ch if c < 0xF000 else ""))
            return "".join(out)
    return text.translate(SYMBOL_PUA).replace("\x07", " ")   # Pearson's tab after "Step 1"


FRACTIONS = {"¹₂": "½", "¹₃": "⅓", "²₃": "⅔", "¹₄": "¼", "³₄": "¾"}
# Cambria Math can print each maths letter twice ("𝑝𝑝(𝐶𝐶…" for 𝑝(𝐶…).
DOUBLED_MATH = re.compile("([\U0001D400-\U0001D7FF])\\1")


def tidy(t):
    t = t.replace("\uf083", "⇌").replace("⺎", "π")     # glyphs Pearson's fonts misname
    t = t.translate(SYMBOL_PUA)
    t = DOUBLED_MATH.sub(r"\1", t)
    t = re.sub(r"(\d)\s?ᶿ", r"\1°", t)          # a raised o after a number is a degree sign
    t = re.sub(r"ᶿ(?=C\b)", "°", t)               # ...and before C, as in "temperature in °C"
    # Only a lone raised and lowered digit is a fraction: in ¹⁰³₄₅Rh the ³₄ is not ¾.
    for k, v in FRACTIONS.items():
        t = re.sub(f"(?<![⁰¹²³⁴⁵⁶⁷⁸⁹₀-₉]){k}(?![₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹])", v, t)
    t = re.sub(r"[    \t]", " ", t)
    return re.sub(r"\s{2,}", " ", t).strip()


def to_frame(main, W, H, x0, y0, x1, y1):
    """A page rectangle as (u0, u1, v0, v1): along the reading direction, then down it.

    Only order matters, so a sideways page is negated rather than measured
    against its size: a rotated page's text coordinates and its reported size
    are in different spaces.
    """
    if main == (1, 0):
        return x0, x1, y0, y1
    if main == (0, -1):
        return -y1, -y0, x0, x1
    if main == (0, 1):
        return y0, y1, -x1, -x0
    return -x1, -x0, -y1, -y0


def frame(page):
    """Spans in the page's reading frame.

    Question papers read left to right. Cambridge prints its mark schemes
    sideways, reading upwards, so u/v (along/down the line) are worked out from
    the page's dominant direction rather than assumed to be x/y. Text set in
    any other direction is margin furniture and is dropped.
    """
    weight, raw = collections.Counter(), []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for l in b["lines"]:
            d = (round(l["dir"][0]), round(l["dir"][1]))
            for s in l["spans"]:
                if s["text"].strip():
                    weight[d] += len(s["text"])
                    raw.append((d, s))
    if not weight:
        return []
    main = weight.most_common(1)[0][0]
    MAIN[(page.parent.name, page.number)] = main
    W, H = page.rect.width, page.rect.height
    spans, grounds = [], None
    for d, s in raw:
        if d != main or s["size"] < 6.2 or DEBRIS.search(s["text"]):
            continue
        # White text shows only on a dark box or a picture; on the white page
        # it is invisible, left in the text layer ("15" behind a printed 617).
        if s["color"] == 0xFFFFFF:
            if grounds is None:
                grounds = [pymupdf.Rect(dr["rect"]) for dr in page.get_drawings()
                           if dr.get("fill") and sum(dr["fill"]) < 1.5] + \
                          [pymupdf.Rect(i["bbox"]) for i in page.get_image_info()]
            r = pymupdf.Rect(s["bbox"])
            if not any((g & r).get_area() > 0.5 * r.get_area() for g in grounds):
                continue
        # Margin furniture goes before lines are built: AQA's small "Do not
        # write outside the box" otherwise joins the body line beside it as a
        # raised "^outside the box", and PMT's stamp breaks text the same way.
        if main == (1, 0) and (MARGIN_NOTE.match(s["text"].strip()) and s["bbox"][0] > 0.85 * W
                               or s["text"].strip() == "PMT"):
            continue
        u0, u1, v0, v1 = to_frame(main, W, H, *s["bbox"])
        base = to_frame(main, W, H, *s["origin"], *s["origin"])[2]
        spans.append(Span(s["text"], s["size"], bool(s["flags"] & 16), u0, u1, v0, v1, base, s.get("font", "")))
    return spans


def visual_lines(page):
    spans = sorted(frame(page), key=lambda s: ((s.v0 + s.v1) / 2, s.u0))
    upright = MAIN.get((page.parent.name, page.number), (1, 0)) == (1, 0)
    big = max((s.size for s in spans), default=0)
    groups = []                                 # [v0, v1, spans]

    def best_group(s, slack):
        best, best_ov = None, 0.0
        for g in groups[-10:]:
            h = g[1] - g[0]
            lo, hi = g[0] - slack * h, g[1] + slack * h
            ov = min(hi, s.v1) - max(lo, s.v0)
            r = ov / (min(h, s.v1 - s.v0) or 1)
            if r > best_ov:
                best, best_ov = g, r
        return best, best_ov

    # Full-size text first, so a raised charge or a lowered subscript can then
    # find the line it belongs to whichever side of it it sits.
    small = []
    for s in spans:
        neighbours = [x.size for x in spans if abs((x.v0 + x.v1) / 2 - (s.v0 + s.v1) / 2) < 8]
        # A question label in the margin ("0 8 . 3" set small in AQA's boxes)
        # is never a script of the line beside it.
        margin_label = upright and s.u0 < 0.11 * page.rect.width and re.fullmatch(r"[\d\s.()*a-z]{1,8}", s.text.strip())
        if s.size < 0.86 * max(neighbours) and len(s.text.strip()) <= 8 and not margin_label:
            small.append(s)
            continue
        # Full-size text joins the line whose baseline it shares. Matching on
        # overlapping bands let a tall line in one column swallow two lines of
        # the column beside it, interleaving their words.
        g, gap = None, None
        for c in groups[-12:]:
            d = abs(s.base - c[3])
            if d <= 0.3 * max(s.size, c[4]) and (gap is None or d < gap):
                g, gap = c, d
        if g is not None:
            g[2].append(s)
            g[0], g[1] = min(g[0], s.v0), max(g[1], s.v1)
            if s.size > g[4]:
                g[3], g[4] = s.base, s.size          # the line's baseline is its body text's
        else:
            groups.append([s.v0, s.v1, [s], s.base, s.size])
            groups.sort(key=lambda g: g[0])
    for s in small:
        cands = [g for g in groups
                 if g[0] - 0.6 * (g[1] - g[0]) <= (s.v0 + s.v1) / 2 <= g[1] + 0.6 * (g[1] - g[0])
                 and min(x.u0 for x in g[2]) - 15 <= s.u0 <= max(x.u1 for x in g[2]) + 15]
        if cands:
            # A subscript or charge sits hard against the text it belongs to,
            # which settles it when it falls between two lines.
            def fit(g):
                touching = any(abs(s.u0 - x.u1) < 2.0 for x in g[2])
                return (not touching, abs((g[0] + g[1]) / 2 - (s.v0 + s.v1) / 2))
            g = min(cands, key=fit)
            g[2].append(s)
        else:
            groups.append([s.v0, s.v1, [s], s.base, s.size])
            groups.sort(key=lambda g: g[0])
    del big, best_group
    _drawn_arrows(page, groups)
    lines = sorted((Line(page.number, g[2]) for g in groups), key=lambda l: (l.v0, l.u0))
    LINE_BANDS[(page.parent.name, page.number)] = [(l.u0, l.u1, l.v0, l.v1) for l in lines]
    return lines


def _drawn_arrows(page, groups):
    """Put back the arrows equations draw instead of type.

    "C₂H₅OH(g) → C₂H₄(g)" is often set as two runs of text with a drawn
    arrow between, so the text alone reads as two species side by side. A short
    horizontal stroke in the gap between two runs of one line is that arrow;
    two strokes one above the other are an equilibrium.
    """
    main = MAIN.get((page.parent.name, page.number), (1, 0))
    W, H = page.rect.width, page.rect.height
    shafts = []
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] != "l":
                continue
            u0, u1, v0, v1 = to_frame(main, W, H, min(it[1].x, it[2].x), min(it[1].y, it[2].y),
                                      max(it[1].x, it[2].x), max(it[1].y, it[2].y))
            if v1 - v0 < 1.2 and 10 <= u1 - u0 <= 45:
                shafts.append((u0, u1, (v0 + v1) / 2))
    if not shafts:
        return
    every = [x for g in groups for x in g[2]]

    def fraction_bar(sh):
        """Text set just above or below the stroke, across it: a fraction bar."""
        for x in every:
            over = min(x.u1, sh[1]) - max(x.u0, sh[0])
            if over > 0.3 * (sh[1] - sh[0]) and (-2 <= sh[2] - x.v1 <= 10 or -2 <= x.v0 - sh[2] <= 10):
                return True
        return False
    shafts = [sh for sh in shafts if not fraction_bar(sh)]
    for g in groups:
        spans = sorted(g[2], key=lambda s: s.u0)
        for a, b in zip(spans, spans[1:]):
            if b.u0 - a.u1 < 9:
                continue
            # A line between two atom symbols is a bond in a drawn structure.
            if re.fullmatch(r"\s*[A-Z][a-z]?\s*", a.text) and re.fullmatch(r"\s*[A-Z][a-z]?\s*", b.text):
                continue
            inside = [sh for sh in shafts if sh[0] >= a.u1 - 2 and sh[1] <= b.u0 + 2 and g[0] - 2 <= sh[2] <= g[1] + 2]
            if not inside:
                continue
            levels = sorted({round(sh[2]) for sh in inside})
            levels = [v for i, v in enumerate(levels) if i == 0 or v - levels[i - 1] > 1]
            mark = "⇌" if len(levels) >= 2 else "→"
            u = (a.u1 + b.u0) / 2
            g[2].append(Span(mark, a.size, False, u - 3, u + 3, a.v0, a.v1, a.base))


# --------------------------------------------------------------------------
# Page furniture: everything printed on the page that is not a question.
# --------------------------------------------------------------------------

FURNITURE = [re.compile(p, re.I) for p in [
    r"^PMT$", r"^\[?\s*Turn over\s*►?\s*\]?$", r"^Turn over\W{0,3}$", r"^BLANK PAGE$",
    r"^\*\s?[A-Z]?\s?(?:\d\s?){5,}[A-Z]?(?:\s?\d)*\s?\*$",      # Edexcel/OCR barcodes
    r"^\*\s?\d{2}\s?\*$|^0\d{2}\*$",                            # AQA *03*, 002* (not OCR's "17*")
    r"^\d{2}_\d{4}_\d{2}_\d{4}_[\d.]+[A-Z]?$",                   # Cambridge 11_9701_12_2023_1.11R
    r"^\*(?:\s?[\dA-Z]){4,}\s?\*$",
    r"^IB/[A-Z]/\w+/\w+(?:/\w+)*$",                            # AQA IB/M/Jun23/7405/1
    r"^©", r"^\d{4}/\d{2}/[A-Z]/[A-Z]/\d{2}$",                 # Cambridge 9701/42/M/J/24
    r"^Do not write$", r"^outside the$", r"^outside the box$", r"^box$", r"^Do not write\W*outside the(?:\s*box)?$",
    r"^DO NOT WRITE IN THIS (?:AREA|MARGIN)", r"^Additional answer space",
    r"^END OF (?:QUESTION PAPER|QUESTIONS)$", r"^Copyright Information",
    r"^PhysicsAndMathsTutor\.com$", r"^Page \d+ of \d+$", r"^PUBLISHED$",
    r"^There are no questions printed on this page", r"^DO NOT WRITE ON THIS PAGE",
    r"^Question\s*number$", r"^Additional page,? if required", r"^Write the question numbers in the left",
    r"^For confidentiality purposes", r"^Copyright ©",
    r"^Question \d+ continues? on the (?:next|following) page", r"^Turn over for the next question",
    r"^Your answer$", r"^DO NOT WRITE IN THIS SPACE", r"^ANSWER IN THE SPACES? PROVIDED$", r"^D\s?F\s?D$", r"^Pearson Education Limited\. Registered company",
]]
# "Use the following information to answer questions 14 and 15."
SHARED_INFO = re.compile(r"\b(?:information|data|passage|text|diagram)\b.{0,40}\b(?:answer|for)\s+questions?\s+\d+\s*(?:and|to|–|-)\s*\d+"
                         r"|\bQuestions\s+\d+\s*(?:and|to|–|-)\s*\d+\s+(?:refer|relate)\s+to\b", re.I)
NOT_A_QUESTION_PAGE = re.compile(
    r"There are no questions printed on this page|DO NOT WRITE ON THIS PAGE|^\s*BLANK PAGE\s*$", re.I | re.M)
# Cambridge's copyright notice can share the last question's page, so it ends
# the paper where it starts rather than taking the page with it.
END_OF_PAPER = re.compile(r"^END OF (?:QUESTIONS|QUESTION PAPER|PAPER|EXAMINATION)\b|^TOTAL FOR PAPER\b"
                          r"|^Permission to reproduce items where third-party owned material"
                          r"|^Important values, constants and standards", re.I)   # Cambridge's data sheet
DOTS = re.compile(r"^[.\s…_]{6,}$")
DOT_RUN = re.compile(r"[.…]{4,}|_{4,}")


def furniture_text(t):
    t = t.strip().lstrip("_^").strip()
    return any(p.search(t) for p in FURNITURE)


def page_cells(line, height):
    """The line's cells less page furniture, or [] if nothing is left."""
    t = line.text.strip()
    if re.fullmatch(r"\d{1,2}", t) and (line.v1 < 70 or line.v0 > height - 70):
        return []                                   # page number
    return [c for c in line.cells if not furniture_text(c[2])]


# --------------------------------------------------------------------------
# Question paper: labels, marks, the page each part owns.
# --------------------------------------------------------------------------

ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]
LETTERS = "abcdefghijklmnopqrstuvwxyz"
AQA_LABEL = re.compile(r"^(\d)\s?(\d)(?:\s?\.\s?(\d{1,2}))?(?=\s|$)")
LABEL = re.compile(
    r"^(?P<star>\*)?\s*(?P<q>\d{1,2})?\s*(?P<star2>\*)?\s*(?:\*?\((?P<letter>[a-z])\)\*?)?\s*"
    r"(?:\*?\((?P<roman>i{1,3}|iv|vi{0,3}|ix|x)\)\*?)?(?=\s|$)")


class Node:
    def __init__(self, q, mid=None, roman=None):
        self.q, self.mid, self.roman = q, mid, roman      # mid: a letter, or AQA's part number
        self.lines, self.children, self.marks, self.bands = [], [], [], []
        self.pre, self.pre_bands = [], []        # a stem printed between parts, before this one
        self.answer_lines = []                   # labels in its answer space, kept out of the prompt
        self.star = False
        self.marks_from = None
        self.tick_tail = None                    # page of a "Tick (✓) one box" printed after its marks
        self.box_tail = None                     # page of a word box after them; False once ended
        self.tail_v1 = None                      # bottom of the last line taken into either run

    @property
    def key(self):
        return key_of(self.q, self.mid, self.roman)


def key_of(q, mid=None, roman=None):
    return f"{q}|{mid or ''}|{roman or ''}"


def label_of(board, n):
    if board == "aqa":
        return f"{n.q:02d}" + (f".{n.mid}" if n.mid else "")
    return f"{n.q}" + (f"({n.mid})" if n.mid else "") + (f"({n.roman})" if n.roman else "")


class TextLine:
    __slots__ = ("page", "v0", "v1", "u0", "text", "cells")

    def __init__(self, page, v0, v1, cells):
        self.page, self.v0, self.v1, self.cells = page, v0, v1, cells
        self.u0 = cells[0][0]
        self.text = "\t".join(c[2] for c in cells)


def read_label(board, cell, W, stack, cur_q, q_x=None, scheme_keys=frozenset()):
    """(q or None, mid or None, roman or None, rest of the cell, star) if the
    cell opens with the next label in sequence, else None.

    Sequence is what makes this safe: a table row starting "2" or a sentence
    starting "(a)" is only a label if it is the label that comes next.
    """
    u0, _, t = cell
    if board == "aqa":
        m = AQA_LABEL.match(t)
        if not m or u0 > 0.15 * W:
            return None
        q, part = int(m.group(1) + m.group(2)), int(m.group(3)) if m.group(3) else None
        rest = t[m.end():].strip()
        if q == cur_q + 1 and part in (None, 1) and (q_x is None or abs(u0 - q_x) <= 12):
            return q, part, None, rest, False
        if q == cur_q and part is not None and part == (stack[1].mid + 1 if stack[1] else 1):
            return None, part, None, rest, False
        return None

    m = LABEL.match(t)
    if not m or not (m.group("q") or m.group("letter") or m.group("roman")) or u0 > 0.3 * W or u0 < 0:
        return None
    q = int(m.group("q")) if m.group("q") else None
    letter, roman = m.group("letter"), m.group("roman")
    star = "*" in t[:m.end()]
    if q is not None and (q != cur_q + 1 or u0 > 0.15 * W or (q_x is not None and abs(u0 - q_x) > 12)):
        return None
    if q is None and stack[0] is None:
        return None
    new_q = q is not None
    exp_letter = "a" if new_q or stack[1] is None else _next(LETTERS, stack[1].mid)
    exp_roman = "i" if new_q or letter or stack[2] is None else _next(ROMAN, stack[2].roman)
    # After (h), "(i)" is either the next letter or (h)'s first numeral; the
    # mark scheme's own labels say which.
    if letter == "i" and exp_letter == "i" and not roman and not new_q and stack[2] is None \
            and f"{cur_q}|h|i" in scheme_keys:
        letter, roman = None, "i"
    if letter and letter != exp_letter:
        # "(i)" alone is a roman numeral unless the letters really have reached i.
        if letter == "i" and not roman and exp_roman == "i":
            letter, roman = None, "i"
            exp_roman = "i" if stack[2] is None else _next(ROMAN, stack[2].roman)
        elif letter == "v" and not roman and stack[2] is not None and _next(ROMAN, stack[2].roman) == "v":
            letter, roman = None, "v"
        elif letter == "x" and not roman and stack[2] is not None and _next(ROMAN, stack[2].roman) == "x":
            letter, roman = None, "x"
        else:
            return None
    if roman:
        expected = "i" if (new_q or letter) else (_next(ROMAN, stack[2].roman) if stack[2] else "i")
        if roman != expected:
            return None
    return q, letter, roman, t[m.end():].strip(), star


def _next(seq, cur):
    i = seq.index(cur) if cur in seq else -1
    return seq[i + 1] if i + 1 < len(seq) else None


def parse_qp(doc, board, scheme_keys=frozenset()):
    W = doc[0].rect.width
    questions, stack, cur_q, q_x = [], [None, None, None], 0, None
    totals, cover_total, one_mark_each = {}, None, False
    owned = []                                   # (node, page, v0) per line, in reading order
    token = MARK_TOKEN[board]
    ended = False
    pending, pending_owned = [], []             # text between parts: the next parts' stem
    shared_for, shared_lines = set(), []        # a stem printed for several questions
    prev_bare = None                             # the line before, if it was a bare number
    for page in doc:
        H = page.rect.height
        if NOT_A_QUESTION_PAGE.search(page.get_text()):
            continue
        page_lines = visual_lines(page)
        if MAIN.get((page.parent.name, page.number), (1, 0)) != (1, 0):
            continue                             # a periodic table or data sheet set sideways
        for line in page_lines:
            if ended:
                break
            if END_OF_PAPER.search(line.text.strip()):
                ended = bool(questions)
                continue
            if page.number < 3:
                m = PAPER_TOTAL.search(line.text)
                if m and cover_total is None:
                    cover_total = int(m.group(1) or m.group(2))
                one_mark_each = one_mark_each or bool(ONE_MARK_EACH.search(line.text))
            cells = page_cells(line, H)
            if not cells:
                continue
            joined = " ".join(c[2] for c in cells)
            # Question totals: Edexcel's own line, Cambridge's at the end of a
            # line, AQA's in the right-margin box.
            if board == "edexcel":
                m = EDEXCEL_TOTAL.match(joined)
                if m:
                    totals[int(m.group(1))] = int(m.group(2))
                    continue
            if board == "cambridge":
                m = CAMBRIDGE_TOTAL.search(cells[-1][2])
                if m and cells[-1][1] > 0.6 * W and cur_q:
                    totals[cur_q] = int(m.group(1))
                    rest = cells[-1][2][:m.start()].strip()
                    cells = cells[:-1] + ([(cells[-1][0], cells[-1][1], rest)] if rest else [])
                    if not cells:
                        continue
            if board == "aqa":
                m = re.match(r"^(.*\S)\s+(\d{1,2})$", cells[-1][2]) if cells[-1][1] > 0.9 * W else None
                if m and (DOT_RUN.search(m.group(1)) or re.search(r"\]$|\b[A-Za-zΩ°%]{1,6}$", m.group(1))) \
                        and not re.search(r"[=×]\s*$", m.group(1)):
                    cells = cells[:-1] + [(cells[-1][0], cells[-1][1], m.group(1)), (cells[-1][1], cells[-1][1], m.group(2))]
                m = re.match(r"^(.*\[\s*\d+\s*marks?\s*\])\s+(\d{1,2})$", cells[-1][2], re.I)
                if m and cells[-1][1] > 0.9 * W:
                    cells = cells[:-1] + [(cells[-1][0], cells[-1][1], m.group(1)), (cells[-1][1], cells[-1][1], m.group(2))]
            if board == "aqa" and cells[-1][0] > 0.9 * W and re.fullmatch(r"\d{1,2}", cells[-1][2]):
                if cur_q:
                    totals[cur_q] = int(cells[-1][2])
                cells = cells[:-1]
                if not cells:
                    continue
            # The part's marks, at the right-hand edge.
            marks = None
            u0, u1, t = cells[-1]
            if u1 > 0.7 * W:
                m = token.search(t)
                if m:
                    marks = int(m.group(1))
                    rest = t[:m.start()].strip()
                    cells = cells[:-1] + ([(u0, u1, rest)] if rest and not DOTS.match(rest) else [])
            # A label opening the line.
            prev_node = next((n for n in reversed(stack) if n is not None), None)
            # AQA's label box can sit a little high and read as raised ("^0 3 . 1").
            if board == "aqa" and cells and re.match(r"\^\d\s?\d\s?\.", cells[0][2]):
                cells = [(cells[0][0], cells[0][1], cells[0][2][1:])] + cells[1:]
            lab = read_label(board, cells[0], W, stack, cur_q, q_x, scheme_keys) if cells else None
            bare = cells[0][2].strip() if len(cells) == 1 and re.fullmatch(r"\d{1,2}", cells[0][2].strip()) else None
            # Numbered answer lines ("1", "2" for "Give two factors") are not
            # the next question: a bare number after a bare number one lower.
            if lab and bare and prev_bare == str(int(bare) - 1):
                lab = None
            # A data table's first column ("3 | 12.5 | 14.0") is not question 3.
            if lab and lab[0] is not None and lab[1] is None and lab[2] is None and not lab[3].strip() \
                    and len(cells) >= 3 and all(re.fullmatch(r"[\d.,±–\-\s]+", c[2]) for c in cells[1:]):
                lab = None
            prev_bare = bare
            if not lab:
                m = SHARED_INFO.search(" ".join(c[2] for c in cells))
                if m:
                    named = [int(n) for n in re.findall(r"\d+", m.group(0))]
                    shared_for = set(range(min(named), max(named) + 1))
                    shared_lines = []
            # Held only until the first question it names; that question's own
            # lines are its own.
            if not lab and shared_for and cells and cur_q not in shared_for:
                shared_lines.append(TextLine(page.number, line.v0, line.v1, cells))
                continue                                 # held for the questions it names
            if lab:
                q, mid, roman, rest, star = lab
                if q is not None:
                    # Every question number sits where question 1's did; a
                    # table row or a numbered list further in is not one.
                    q_x = cells[0][0] if q_x is None else q_x
                    node = Node(q)
                    node.star = star and mid is None
                    questions.append(node)
                    if q in shared_for:
                        node.lines = list(shared_lines)
                    elif shared_for and q > max(shared_for):
                        shared_for, shared_lines = set(), []
                    stack, cur_q = [node, None, None], q
                if mid is not None:
                    node = Node(stack[0].q, mid)
                    node.star = star and roman is None
                    stack[0].children.append(node)
                    stack[1], stack[2] = node, None
                if roman is not None:
                    node = Node(stack[0].q, stack[1].mid if stack[1] else None, roman)
                    node.star = star
                    (stack[1] or stack[0]).children.append(node)
                    stack[2] = node
                cells = ([(cells[0][0], cells[0][1], rest)] if rest else []) + cells[1:]
                opened = stack[0] if q is not None else stack[1] if mid is not None else stack[2]
                if q is not None:
                    # Text after a question's last part is that part's answer
                    # space; it stays with it, out of the prompt.
                    last_leaf = prev_node
                    if pending and last_leaf is not None:
                        last_leaf.answer_lines += pending
                        owned += [(last_leaf, o[1], o[2], False) for o in pending_owned]
                    pending, pending_owned = [], []
                elif pending:
                    opened.pre = pending
                    for o in pending_owned:
                        owned.append((opened, o[1], o[2], True))
                    pending, pending_owned = [], []
            node = next((n for n in reversed(stack) if n is not None), None)
            if node is None:
                continue                                 # cover, instructions, data
            if not lab and marks is None and node.marks and not node.children and cells:
                # Past a part's marks: its answer space ("Mass  g", "Isomer 1"),
                # then perhaps the stem of the parts that follow. A sentence
                # starts that stem; everything after it is the stem too.
                first = cells[0][2]
                joined = " ".join(c[2] for c in cells)
                # AQA (2025) prints "[2 marks]" before "Tick (✓) two boxes." and
                # the options: the instruction joins the prompt, the options its
                # answer space. A word box ("Choose answers from the box. [2 marks]",
                # then the box and the sentences to complete) is the question itself.
                # Either run ends at a figure's stem, the next page, or a gap: the
                # next stem sits 60pt below, where options are about 22pt apart.
                gap = line.v0 - node.tail_v1 if node.tail_v1 is not None else 0
                if node.tick_tail is not None and (node.tick_tail != page.number or FIG_REF.match(joined)
                                                   or TABLE_REF.match(joined) or gap > 40):
                    node.tick_tail = None
                if node.box_tail is None and not pending and BOX_ANSWER.search(
                        " ".join(l.text for l in node.lines)):
                    node.box_tail = page.number
                if node.box_tail:
                    if node.box_tail != page.number or FIG_REF.match(joined) or TABLE_REF.match(joined) or gap > 40:
                        node.box_tail = False            # ended: never restarts
                    else:
                        node.lines.append(TextLine(page.number, line.v0, line.v1, cells))
                        owned.append((node, page.number, line.v0, False))
                        node.tail_v1 = line.v1
                        continue
                if not pending and TICK_ANSWER.match(joined):
                    node.tick_tail, node.tail_v1 = page.number, line.v1
                    node.lines.append(TextLine(page.number, line.v0, line.v1, cells))
                    owned.append((node, page.number, line.v0, False))
                    continue
                if not pending and node.tick_tail is not None:
                    node.answer_lines.append(TextLine(page.number, line.v0, line.v1, cells))
                    owned.append((node, page.number, line.v0, False))
                    node.tail_v1 = line.v1
                    continue
                if not pending and (OPTION_LINE.match(first) or OPTION_CELL.match(first)):
                    pass                                 # its multiple-choice options
                elif not pending and FORMULA.search(" ".join(c[2] for c in cells)):
                    pass                                 # the equation or formula the part asks about
                elif pending or is_sentence(cells):
                    pending.append(TextLine(page.number, line.v0, line.v1, cells))
                    pending_owned.append((None, page.number, line.v0))
                    continue
                elif not (OPTION_LINE.match(first) or OPTION_CELL.match(first)):
                    node.answer_lines.append(TextLine(page.number, line.v0, line.v1, cells))
                    owned.append((node, page.number, line.v0, False))
                    continue
            if cells:
                node.lines.append(TextLine(page.number, line.v0, line.v1, cells))
            if marks is not None:
                node.marks.append(marks)
                node.tail_v1 = line.v1                   # a run after the marks is measured from them
            owned.append((node, page.number, line.v0, False))
    _assign_bands(doc, owned)
    return questions, totals, cover_total, one_mark_each


def _assign_bands(doc, owned):
    """Each line's node owns the page from that line down to the next line.

    A figure drawn between two lines of text belongs to the part above it, and
    the top of a page belongs to whichever part carried on onto it.
    """
    owned.sort(key=lambda o: (o[1], o[2]))
    for i, (node, page, v0, pre) in enumerate(owned):
        H = doc[page].rect.height
        nxt = owned[i + 1] if i + 1 < len(owned) else None
        end = nxt[2] if nxt and nxt[1] == page else H - 45
        start = v0
        if i == 0 or owned[i - 1][1] != page:
            start = 45
        (node.pre_bands if pre else node.bands).append((page, start, end))


def raw_text(lines):
    """Everything printed for a part, answer-space labels included: what a
    reader may legitimately copy, for the check to hold rows to."""
    return "\n".join(clean(l.text.replace("\t", " ")) for l in lines if not DOTS.match(l.text))


def wraps_on(above, line):
    """A line carrying on the option above it: that one is long, has not ended,
    and this one opens with a lower-case word ("is more likely to be counted.").
    Short options ("cornea", "iris", "lens") never wrap."""
    return len(above.split()) >= 6 and not re.search(r"[.?!:]$", above) \
        and bool(re.match(r"(?:[a-z]{2,}\b|a\s+[a-z])", line))


def tick_box_options(lines, ink):
    """Options set as lines with a box to tick beside each ("Tick (✓) one box").
    Their letters are not printed, so the options carry none."""
    boxed = []
    for i, l in enumerate(lines):
        right = max(c[1] for c in l.cells)
        left = min(c[0] for c in l.cells)
        for r in ink.get(l.page, {}).get("ticks", []):
            if l.v0 - 4 <= (r.y0 + r.y1) / 2 <= l.v1 + 4 and (r.x0 >= right - 2 or r.x1 <= left + 2):
                boxed.append(i)
                break
    if len(boxed) < 2:
        # AQA draws each box from four separate rules, so the boxes may not be
        # found; the short lines after "Tick (✓) one box." are the options.
        at = next((i for i, l in enumerate(lines) if TICK_ANSWER.search(l.text)), None)
        if at is None:
            return None, lines
        boxed = []
        for i in range(at + 1, len(lines)):
            t = clean(lines[i].text.replace("\t", " "))
            if not t or DOTS.match(lines[i].text):
                continue
            if len(t.split()) > 15 or t.endswith("?"):
                break
            if boxed and wraps_on(clean(lines[boxed[-1]].text), t):
                continue                         # the option above, carried on
            boxed.append(i)
        if len(boxed) < 2:
            # Boxes printed in one row ("Trial 1  Trial 2  Trial 3  Trial 4"):
            # the row's cells are the options.
            row = next((i for i in range(at + 1, len(lines))
                        if len(lines[i].cells) >= 2 and all(len(c[2].split()) <= 4 for c in lines[i].cells)), None)
            if row is None:
                return None, lines
            opts = [{"letter": None, "text": clean(c[2])} for c in lines[row].cells if clean(c[2])]
            return opts, [l for i, l in enumerate(lines) if i != row]
    # An option that wraps carries on in a line starting lower case.
    used, opts = set(boxed), []
    for i in boxed:
        text = clean(lines[i].text.replace("\t", " "))
        j = i + 1
        while j < len(lines) and j not in used and wraps_on(text, clean(lines[j].text)):
            text += " " + clean(lines[j].text.replace("\t", " "))
            used.add(j)
            j += 1
        opts.append({"letter": None, "text": text})
    return opts, [l for i, l in enumerate(lines) if i not in used]


def inherited_pre(parent, node):
    """The stem printed between parts that applies to this one: its own, or
    the latest one printed before an earlier sibling."""
    sibs = parent.children[:parent.children.index(node) + 1]
    for s in reversed(sibs):
        if s.pre:
            return s
    return None


def leaves(q):
    out = []

    def walk(n, ancestors):
        if not n.children:
            out.append((n, ancestors))
        for c in n.children:
            walk(c, ancestors + [n])
    walk(q, [])
    return out


# --- figures ---------------------------------------------------------------

FIG_REF = re.compile(
    r"\b(?:Fig(?:ure)?\.?\s*\d+(?:\.\d+)?|(?<!genetic )diagram|graph|photograph|micrograph"
    r"|(?:mass|IR|infrared|NMR|absorption|emission|line|¹H|¹³C|13C) spectr(?:um|a)"
    r"|chromatogram|the structures? shown|shown (?:below|above|opposite))\b", re.I)
TABLE_REF = re.compile(r"\bTable\s*\d+(?:\.\d+)?\b", re.I)
DRAWN_ANSWER = re.compile(
    r"^(?:Draw|Sketch|Plot|Label|Annotate|Shade|Circle|Draw a ring"
    r"|Complete (?:the )?(?:Fig|Figure|Table|diagram|graph|grid|ray|dot-and-cross|displayed|Punnett|Born)"
    r"|On (?:Fig|Figure|the graph|the diagram|the grid))\b"
    r"|\b(?:on|in) (?:Fig\.?|Figure) ?\d|\bdraw (?:a|the|an)\b"
    r"|\bon the (?:graph|grid|axes|diagram)\b|\b(?:displayed|skeletal) formula", re.I | re.M)
# A tick-box answer is a multiple choice once its boxes are read as options.
USE_FIGURE_FOR = re.compile(r"Use (?:the )?information (?:from|in) ((?:Figure|Fig\.?) ?\d+(?:\.\d+)?)"
                            r"[^.]{0,40}?answer questions? (\d{1,2}\.\d+) (?:to|and) (\d{1,2}\.\d+)", re.I)
BOX_ANSWER = re.compile(r"\bfrom the box\b|\bComplete the sentences?\b", re.I)
TICK_ANSWER = re.compile(r"^Tick\b|\bTick \(✓\)|\(\s*✓\s*\)|Put a (?:cross|tick)", re.I | re.M)
# A part that leans on its stem's figure says so.
USES_FIGURE = re.compile(r"\bshown\b|\bthis (?:structure|graph|diagram|figure|apparatus|cell)\b"
                         r"|\b(?:point|position|structure|part|line|curve|region|peak|stage) [A-Z]\b"
                         r"|\blabelled\b|\bthe (?:graph|diagram|trace|curve|results)\b", re.I)
TICK_WORDS = re.compile(r"\btick|\bboxes?\b|\bcross\b|✓|☒", re.I)


def page_ink(page):
    """Sort a page's drawings and pictures.

    Answer lines, table rules and empty answer boxes are ruled furniture. What
    remains (curves, diagonal strokes, filled shapes, pictures) is a figure.
    """
    ink, ticks = [], []
    W = page.rect.width
    bands = LINE_BANDS.get((page.parent.name, page.number), [])
    for d in page.get_drawings():
        r = d["rect"]
        w, h = r.width, r.height
        # The margins carry their own furniture: Edexcel's hatched "do not
        # write" strip, AQA's mark boxes, the black registration bars.
        centre = (r.x0 + r.x1) / 2
        if centre > 0.8 * W or centre < 0.08 * W:
            continue
        if w > 0.6 * W and h > 0.4 * page.rect.height:
            continue                                    # the page's own border, rounded or not
        kinds = {it[0] for it in d["items"]}
        if (h < 2.0 and w > 20) or (w < 2.0 and h > 20) or (w < 2 and h < 2):
            continue                                    # rules and dots
        if kinds <= {"re", "l", "qu"} and 5 <= w <= 18 and 5 <= h <= 18 and abs(w - h) < 3:
            ticks.append(r)
            continue
        if w <= 14 and h <= 14:
            ticks.append(r)                             # AQA's answer bubbles, small boxes
            continue
        if kinds == {"re"} and not d.get("fill"):
            continue                                    # answer boxes, table cells
        if kinds == {"re"} and d.get("fill") in ((1.0, 1.0, 1.0), None):
            continue
        diagonal = any(it[0] == "l" and abs(it[1].x - it[2].x) > 1 and abs(it[1].y - it[2].y) > 1
                       for it in d["items"])
        curved = "c" in kinds
        filled = d.get("fill") not in (None, (1.0, 1.0, 1.0)) and w * h > 12 and kinds != {"re"}
        # An arrowhead, a bracket or a root sign drawn inside a line of text
        # is part of that line, not a figure.
        inline = w < 25 and h < 25 and any(b[2] - 2 <= (r.y0 + r.y1) / 2 <= b[3] + 2 and b[0] - 4 <= r.x0 <= b[1] + 4
                                           for b in bands)
        if (diagonal or curved or filled) and not inline:
            ink.append(r)
    images = []
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"])
        if r.width * r.height >= 1500 and r.x1 > 45 and r.x0 < page.rect.width - 45:
            images.append(r)
    return {"ink": ink, "ticks": ticks, "images": images}


def figures_in(ink_by_page, bands, width):
    found = {"images": 0, "ink": 0, "ticks": 0}
    for page, v0, v1 in bands:
        ink = ink_by_page.get(page)
        if not ink or v1 - v0 < 2:
            continue
        band = pymupdf.Rect(0, v0 - 1, width, v1 + 1)
        found["images"] += sum(1 for r in ink["images"] if _inside(r, band) > 0.5)
        found["ink"] += sum(1 for r in ink["ink"] if _inside(r, band) > 0.6)
        found["ticks"] += sum(1 for r in ink["ticks"] if _inside(r, band) > 0.6)
    return found


def _inside(r, band):
    inter = pymupdf.Rect(r) & band
    area = r.width * r.height
    if area <= 0:
        return 1.0 if band.contains(r.tl) else 0.0
    return 0.0 if inter.is_empty else (inter.width * inter.height) / area


# --------------------------------------------------------------------------
# Mark scheme: columns by the table's rules, entries keyed to parts.
# --------------------------------------------------------------------------

HEADER_WORDS = [
    ("question", r"Q(?:uestion|u\.)(?:\s*(?:Number|No\.?))?"),
    ("answer", r"Answers?|Marking\s+guidance|Acceptable\s+answers?|Expected\s+answers?|Indicative\s+content|Key"),
    ("guidance", r"Additional\s+(?:guidance|comments?(?:\s*/\s*(?:guidance|guidelines))?)|Guidance|Guidelines"
                 r"|Comments?|Notes?|Extra\s+information"),
    ("marks", r"Mar\s?ks?"),
    ("ao", r"AO(?:\s*element)?"),
    ("ref", r"ID(?:\s+details)?|details|Spec(?:ification)?\.?\s*(?:ref(?:erence)?|point)s?\.?"),
]
HEADER_RE = re.compile("|".join(f"(?P<{n}>\\b(?:{p})\\b)" for n, p in HEADER_WORDS), re.I)
MS_LABEL_AQA = re.compile(r"^(?:0\s?)?(\d)\s?(\d)?(?:\s?\.\s?(\d{1,2}))?(?=\s|$)")
MS_LABEL = re.compile(
    r"^\*?\s*(?P<q>\d{1,2})?\s*\*?\s*(?:\*?\(\s*(?P<letter>[a-z])\s*\*?\s*\)\*?|(?P<bare_letter>[a-h])(?=\s|$|\())?\s*"
    r"(?:\*?\(\s*(?P<roman>(?i:i{1,3}|iv|vi{0,3}|ix|x))\s*\*?\s*\)(?P<item>[1-9](?=\s|$))?|(?P<bare_roman>(?i:i{1,3}|iv|vi{0,3}|ix|x))(?=\s|$))?"
    r"\s*\*?(?=\s|$)")


def table_rules(page):
    """The page's ruling in its reading frame: vertical (u, v0, v1), horizontal (v, u0, u1)."""
    main = MAIN.get((page.parent.name, page.number), (1, 0))
    W, H = page.rect.width, page.rect.height
    vertical, horizontal = [], []
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] == "l":
                p, q = it[1], it[2]
                rects = [(min(p.x, q.x), min(p.y, q.y), max(p.x, q.x), max(p.y, q.y))]
            elif it[0] == "re":
                r = it[1]
                if r.width < 2.5 or r.height < 2.5:
                    rects = [(r.x0, r.y0, r.x1, r.y1)]
                else:
                    rects = [(r.x0, r.y0, r.x0, r.y1), (r.x1, r.y0, r.x1, r.y1),
                             (r.x0, r.y0, r.x1, r.y0), (r.x0, r.y1, r.x1, r.y1)]
            else:
                continue
            for rect in rects:
                u0, u1, v0, v1 = to_frame(main, W, H, *rect)
                if u1 - u0 < 2.5 and v1 - v0 > 12:
                    vertical.append(((u0 + u1) / 2, v0, v1))
                elif v1 - v0 < 2.5 and u1 - u0 > 40:
                    horizontal.append(((v0 + v1) / 2, u0, u1))
    return vertical, horizontal


def header_cells(lines):
    """{column name: (u0, u1)} if these lines are a scheme table's header row.

    Matched over the whole row and mapped back to positions, because two
    headings can arrive as one span ("Question Answers"), one heading as
    several ("Additional" / "comments/Guidelines"), and a heading can wrap onto
    a second line. A row that says anything besides headings is prose that
    happens to mention one, not a header.
    """
    if isinstance(lines, Line):
        lines = [lines]
    text, starts = "", []
    for s in sorted((s for l in lines for s in l.spans), key=lambda s: (s.u0, s.v0)):
        if text:
            text += " "
        starts.append((len(text), s))
        text += tidy(s.text)
    leftover = HEADER_RE.sub(" ", text)
    if re.search(r"[A-Za-z]{3,}", re.sub(r"\b(?:Number|No|Max|Total|element|Mark Scheme)\b", " ", leftover, flags=re.I)):
        return None
    cols = {}
    for m in HEADER_RE.finditer(text):
        name = m.lastgroup
        if name in cols:
            continue
        i = m.start()
        start, span = max((st for st in starts if st[0] <= i), key=lambda st: st[0])
        n = max(len(tidy(span.text)), 1)
        frac0, frac1 = (i - start) / n, min(1.0, (m.end() - start) / n)
        cols[name] = (span.u0 + (span.u1 - span.u0) * frac0, span.u0 + (span.u1 - span.u0) * frac1)
    if "question" in cols and ("answer" in cols or "marks" in cols):
        return cols
    return None


def columns_for(header, lines, rules):
    """Column intervals [(name, lo, hi)] for the table under this header.

    A header is centred over its column while the answers start at the
    column's left edge, so the header alone cannot say where a column begins;
    the vertical rules crossing the header row can. Without ruling, each
    boundary falls midway between one header's end and the next one's start.
    """
    named = sorted(header.items(), key=lambda kv: kv[1][0])
    top, bottom = min(l.v0 for l in lines), max(l.v1 for l in lines)
    us = sorted(u for u, v0, v1 in rules if v0 <= bottom + 4 and v1 >= top - 4)
    edges = []
    for u in us:
        if not edges or u - edges[-1] > 4:
            edges.append(u)
    if len(edges) >= 3:
        bounds = [-1e9] + edges + [1e9]
        cols = []
        for name, (u0, u1) in named:
            centre = (u0 + u1) / 2
            for lo, hi in zip(bounds[:-1], bounds[1:]):
                if lo <= centre < hi:
                    cols.append((name, lo, hi))
                    break
        cols.sort(key=lambda c: c[1])
        # A ruled column with no header of its own belongs to the named one on its left.
        return [(name, lo if i else -1e9, cols[i + 1][1] if i + 1 < len(cols) else 1e9)
                for i, (name, lo, hi) in enumerate(cols)]
    out = []
    for i, (name, (u0, u1)) in enumerate(named):
        lo = -1e9 if i == 0 else (named[i - 1][1][1] + u0) / 2
        hi = 1e9 if i + 1 == len(named) else (u1 + named[i + 1][1][0]) / 2
        out.append((name, lo, hi))
    return out


def column_of(cols, u0):
    for name, lo, hi in cols:
        if lo - 3 <= u0 < hi - 3:
            return name
    return cols[-1][0]


def ms_key(board, qtext, last):
    """(part key, carry, text after the label) for a question-column cell that
    opens with a label, carrying the question and letter down from the row
    above where the scheme leaves them out. Answer text that starts a little
    left of its column lands after the label in the same cell; it is returned
    so it can go back to the answer."""
    t = re.sub(r"\s+", " ", qtext).strip()
    t = re.sub(r"^\^(?=\d)", "", t)             # a label set a little high ("^2(b)(ii)")
    if board == "aqa":
        m = MS_LABEL_AQA.match(t)
        if not m:
            return None
        q = int(m.group(1) + (m.group(2) or ""))
        return key_of(q, int(m.group(3)) if m.group(3) else None), (q, None), t[m.end():].strip()
    # Edexcel can run letter and numeral together in one bracket: "1(ai)".
    t = re.sub(r"^(\d{1,2})\s*\(([a-h])(i{1,3}|iv|vi{0,3}|ix)\)", r"\1(\2)(\3)", t)
    m = MS_LABEL.match(t)
    if not m:
        return None
    letter = m.group("letter") or m.group("bare_letter")
    roman = (m.group("roman") or m.group("bare_roman") or "").lower() or None
    # A bare letter only counts beside a question number ("1 a i"); alone it
    # is an answer ("a").
    if m.group("bare_letter") and not m.group("q") and not (roman or (
            last[1] and LETTERS.index(m.group("bare_letter")) == LETTERS.index(last[1]) + 1)):
        return None
    if not (m.group("q") or letter or roman):
        return None
    # "(i)" in a row of its own continues the lettered part above, unless the
    # letters really have reached i.
    if letter in ("i", "v", "x") and not roman and not m.group("q") and last[1] and \
            LETTERS.index(letter) != LETTERS.index(last[1]) + 1:
        letter, roman = None, letter
    q = int(m.group("q")) if m.group("q") else last[0]
    # "18 | (blank) | (iii)": the question reprinted with its letter left out
    # carries the letter down, as a row with no question number does.
    if letter is None and roman and (not m.group("q") or q == last[0]):
        letter = last[1]
    if q is None:
        return None
    rest = t[m.end():].strip()
    if m.group("item"):                    # OCR's "(ii)1": the item keeps its number
        rest = f"{m.group('item')} {rest}".strip()
    return key_of(q, letter, roman), (q, letter), rest


AO_NOTE = re.compile(r"\(?\s*(?:\d+\s*[x×]\s*)?AO\s?\d[\d.]*[a-z]?\s*[,)]?", re.I)


def table_rows(page, lines):
    """The page's lines grouped by the table row they sit in.

    A row's cells are not aligned on one baseline: AQA centres the question
    number in a tall row and tops the mark, so reading line by line credits
    the mark to the row above. The horizontal rules say which row a line is in.
    Lines outside the ruled table (running heads, footers) are left out. A page
    with no ruling falls back to one row per line.
    """
    vertical, horizontal = table_rules(page)
    long_v = [r for r in vertical if r[2] - r[1] > 12]
    if not long_v:
        return [[l] for l in lines]
    top = min(r[1] for r in long_v)
    bottom = max(r[2] for r in long_v)
    left = min(r[0] for r in long_v)
    right = max(r[0] for r in long_v)
    # Row borders are often drawn one cell at a time, so join the pieces at
    # each height before asking whether a border crosses the table.
    levels = []
    for v, u0, u1 in sorted(horizontal):
        if levels and v - levels[-1][0] <= 1.5:
            levels[-1][1].append((u0, u1))
        else:
            levels.append([v, [(u0, u1)]])
    cuts = []
    for v, pieces in levels:
        covered, end = 0.0, -1e9
        for a, b in sorted(pieces):
            a = max(a, end)
            if b > a:
                covered += b - a
                end = b
        if covered > 0.5 * (right - left) and (not cuts or v - cuts[-1] > 3):
            cuts.append(v)
    rows, last_row = [], None
    for l in lines:
        mid = (l.v0 + l.v1) / 2
        if not (top - 2 <= mid <= bottom + 2) or l.u1 < left - 2 or l.u0 > right + 2:
            continue
        row = sum(1 for c in cuts if c < mid)
        if row != last_row:
            rows.append([])
            last_row = row
        rows[-1].append(l)
    return rows


# "H556/01 Mark Scheme June 2023", "12" — the scheme's running head and page number.
MS_RUNNING_HEAD = re.compile(r"^(?:\d{1,3}\s+)?(?:[A-Z]?\d{3,4}/\d{2}\s+)?Mark Scheme\s+(?:\w+\s+)?\d{4}(?:\s+\d{1,3})?$"
                             r"|^[A-Z]\d{3}/\d{2}$", re.I)
MS_BACK_PAGE = re.compile(r"Oxford Cambridge and RSA Examinations|Expression of Interest|OCR is part of Cambridge", re.I)


def parse_ms(doc, board):
    entries, cols, cur, last = collections.OrderedDict(), None, None, (None, None)

    def entry(key):
        return entries.setdefault(key, {"answer": [], "guidance": [], "marks": [], "ao": [], "pages": set(),
                                        "ao_codes": set(), "picture": False, "max": []})

    for page in doc:
        lines = visual_lines(page)
        if MS_BACK_PAGE.search(page.get_text()) and not any(header_cells(l) for l in lines):
            continue                                    # the board's back page, not a scheme
        vertical = table_rules(page)[0]
        lines = [l for l in lines if not MS_RUNNING_HEAD.match(re.sub(r"\s+", " ", l.text).strip())]
        rows = table_rows(page, lines)
        main = MAIN.get((page.parent.name, page.number), (1, 0))
        pictures = []
        for info in page.get_image_info():
            r = pymupdf.Rect(info["bbox"])
            if r.width * r.height >= 1500:
                pictures.append(to_frame(main, page.rect.width, page.rect.height, *r))
        skip = set()
        for r, row in enumerate(rows):
            if r in skip:
                continue
            head = header_cells(row)
            if not head and r + 1 < len(rows) and any("Question" in l.text for l in row) \
                    and rows[r + 1][0].v0 - row[-1].v1 < 14:
                head = header_cells(row + rows[r + 1])      # a heading wrapped onto a second line
                if head:
                    row = row + rows[r + 1]
                    skip.add(r + 1)
            if head:
                cols = columns_for(head, row, vertical)
                continue
            for line in row:
                if header_cells(line):
                    cols = columns_for(header_cells(line), [line], vertical)
            row = [l for l in row if not header_cells(l)]
            if not cols or not row:
                continue
            split = [l.columns(cols) for l in row]
            # Where in the row its label is; lines above it in the same row are its too.
            labels = []
            clip = False
            for i, parts in enumerate(split):
                q = parts.get("question", "").strip()
                # Pearson's marking notes in the question column ("Clip all of
                # (b)", "Clip with (b)(i)") name parts but are not labels.
                if re.match(r"^Clip\b", q, re.I):
                    clip = True
                    parts["question"] = ""
                    continue
                if clip and q:
                    clip = False
                    parts["question"] = ""
                    continue
                found = ms_key(board, q, last) if q else None
                if found and found[0].endswith("||"):
                    # "2" alone is a question's own label only before any of
                    # its parts; after them, or as 0, it is a number in the column.
                    qn = int(found[0].split("|")[0])
                    # ...and only the next question: "50 x 4.2 x 30" is an answer.
                    if qn == 0 or any(k.split("|")[0] == str(qn) for k in entries) or \
                            (last[0] is not None and (qn < last[0] or qn > last[0] + 1)):
                        found = None
                # "50 x 4.2 x 30" (read as 50(x)) is an answer that starts with a
                # number: a jump in question number followed by more arithmetic.
                if found and last[0] is not None and \
                        int(found[0].split("|")[0]) not in (last[0], last[0] + 1) and \
                        re.match(r"[\d.(×x=+\-–/]", found[2] or ""):
                    found = None
                if found:
                    labels.append((i, found))
                    last = found[1]
                    parts["question"] = ""
                    if found[2]:
                        parts["answer"] = (found[2] + " " + parts.get("answer", "")).strip()
            if not labels and (all(not p.get("answer") and not p.get("guidance") for p in split)
                               or any(re.fullmatch(r"(?:Section\s+[A-Z]\s+)?Total(?:\s+Question(?:\s+\d+)?)?",
                                                   v.strip(), re.I)
                                      for p in split for v in p.values())):
                continue                           # a question's or section's total row
            bounds = [i for i, _ in labels] + [len(split)]
            if labels:
                # A label centred in a tall ruled row sits below its first
                # lines; the rule above them says they are this part's too.
                bounds[0] = 0
            segments = ([(None, split)] if not labels else
                        [(labels[k][1][0], split[bounds[k]:bounds[k + 1]]) for k in range(len(labels))])
            for key, seg in segments:
                if key is not None:
                    cur = entry(key)
                if cur is None:
                    continue
                cur["pages"].add(page.number + 1)
                seg_lines = [row[i] for i in range(len(split)) if split[i] in seg]
                if seg_lines and any(p[2] <= max(l.v1 for l in seg_lines) and p[3] >= min(l.v0 for l in seg_lines)
                                     for p in pictures):
                    cur["picture"] = True          # an answer printed as a drawing
                for parts in seg:
                    q = parts.get("question", "").strip()
                    if q:
                        cur["answer"].append(q)      # answer text set further left than usual
                    mark_text = parts.get("marks", "")
                    for d, x in re.findall(r"A[O0]\s?(\d)(?:\.(\d))?", mark_text + " " + parts.get("ao", "")):
                        cur["ao_codes"].add(f"AO{d}" + (f".{x}" if x else ""))
                    # Edexcel prints the strand after a space: "AO2 1", "AO3 2ab".
                    for d, x, sub in re.findall(r"A[O0]\s?(\d)(?:\s+|\s?[-–]\s?)(\d)([a-z]*)\b", mark_text + " " + parts.get("ao", "")):
                        for letter in (sub or [""]):
                            cur["ao_codes"].add(f"AO{d}.{x}{letter}")
                    # OCR's AO element column prints bare codes: "1.2 x 2  2.6 x 1".
                    for d, x in re.findall(r"(?<![\d.])([1-3])\.(\d)(?![\d.])", parts.get("ao", "")):
                        cur["ao_codes"].add(f"AO{d}.{x}")
                    if re.fullmatch(r"\s*(?:\d+\s*max\.?|max\.?\s*\d+)\s*", mark_text, re.I):
                        cur["max"].append(mark_text.strip())
                        mark_text = ""
                    # Cambridge marks each point with a code in the mark column
                    # (B1, C1, A1, M1): each is worth its digit, and the code
                    # goes with the answer line it marks.
                    codes = re.findall(r"\b([ABCM])(\d)\b", mark_text)
                    # OCR prints the same codes beside its numeric marks: they
                    # go with their line too, but the number is the mark.
                    if codes and re.fullmatch(r"(?:\s*[ABCM]\d\s*)+", mark_text):
                        if board == "cambridge":
                            cur["marks"] += [int(d) for _, d in codes]
                        tag = "[" + " ".join(c + d for c, d in codes) + "]"
                        if parts.get("answer"):
                            parts["answer"] += " " + tag
                        elif cur["answer"]:
                            cur["answer"][-1] += " " + tag
                        mark_text = ""
                    for name in ("answer", "guidance", "ao"):
                        if parts.get(name):
                            cur[name].append(parts[name])
                    m = AO_NOTE.sub(" ", mark_text).strip(" ,()")
                    if re.fullmatch(r"\(?\d{1,2}\)?(?:\s+\(?\d{1,2}\)?)*", m):
                        cur["marks"] += [int(n) for n in re.findall(r"\d{1,2}", m)]
                    elif m and not re.fullmatch(r"\(?\s*\d*\s*[x×]\s*\)?|AO|max\.?", m, re.I):
                        # what is left of "(2 x AO1)" broken over lines is not guidance
                        cur["guidance"].append(m)
    return collections.OrderedDict(
        (k, {"answer": "\n".join(e["answer"]).strip(), "guidance": "\n".join(e["guidance"]).strip(),
             "ao": " ".join(e["ao"]).strip(), "marks": e["marks"], "pages": sorted(e["pages"]),
             "ao_codes": sorted(c for c in e["ao_codes"]       # AO2 goes once AO2.1 is known
                                if not any(o.startswith(c + ".") for o in e["ao_codes"])),
             "picture": e["picture"], "max": e["max"]})
        for k, e in entries.items())


# --------------------------------------------------------------------------
# Putting it together
# --------------------------------------------------------------------------

def identify(doc):
    text = "\n".join(doc[i].get_text() for i in range(min(3, doc.page_count)))
    m = SPEC_CODE.search(text)
    spec = m.group(1) if m else None
    return board_of(spec), spec


def clean(t):
    # Dots that end a line are where the answer goes; dots between words are a
    # blank to fill in, and the sentence needs them to read.
    t = re.sub(r"(?:[.…]{4,}|_{4,})\s*$", " ", t)
    t = re.sub(r"(?<=\S)\s*(?:[.…]{4,}|_{4,})\s*(?=\S)", " \x00 ", t)
    t = DOT_RUN.sub(" ", t).replace("\x00", "______")
    t = ITALIC_L_GAP.sub("", t).translate(LIGATURES)
    return re.sub(r"[ \t]+", " ", t).strip()


LIGATURES = str.maketrans({"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl"})


# An italic l is set wide, so the text layer leaves a space after it inside a
# formula: "Cl ₂", "KCl O₄", "HCl (aq)".
ITALIC_L_GAP = re.compile(r"(?<=[A-Z]l) (?=[₀-₉]|O\b|O[₀-₉]|H[₀-₉]|\((?:aq|s|l|g)\))")


def lines_text(lines, prompt=False, hulls=None):
    """Lines as text. A run of lines with several cells is a table: its cells
    are kept apart with " | ", one table row per line. Short labels printed
    inside a figure ("spring", "block") belong to the figure, not the text."""
    keep = [l for l in lines if not (DOTS.match(l.text) or is_answer_stub(l.text)
                                     or (hulls and in_figure(l, hulls.get(l.page, []))))]
    out = []
    for i, l in enumerate(keep):
        cells = [clean(c[2]) for c in l.cells if clean(c[2])]
        if not cells:
            continue
        table = len(cells) > 1 and any(len(n.cells) > 1 for n in keep[max(0, i - 1):i + 2] if n is not l)
        out.append(" | ".join(cells) if table else clean(" ".join(cells)))
    # What closes a part after its question is the answer space's labels:
    # "change in energy = J", "Mass  g", "pH", "Type of isomerism".
    while prompt and out and (re.fullmatch(r"[^.?=]{1,35}=\s*[^\s\d=]{0,12}", out[-1]) or is_answer_label(out[-1])):
        out.pop()
    # A sentence to complete keeps its gap as a blank, not a column: "… of | ."
    return re.sub(r" \| (?=[.?]$)", " ______", "\n".join(out), flags=re.M)


def figure_hulls(ink):
    """The areas figures occupy on a page: pictures, and drawn strokes merged
    with any stroke within 20 points of them."""
    boxes = [pymupdf.Rect(r) for r in ink["images"]] + [pymupdf.Rect(r) for r in ink["ink"]]
    merged = True
    while merged:
        merged = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                if (a + (-20, -20, 20, 20)).intersects(b):
                    boxes[i] = a | b
                    del boxes[j]
                    merged = True
                    break
            if merged:
                break
    return [b for b in boxes if b.width > 40 and b.height > 30]


def in_figure(line, hulls):
    """Short text inside a figure, or beside it at the end of a leader line
    ("equilibrium position" to the right of the spring)."""
    right = max(c[1] for c in line.cells)
    words = len(line.text.split())
    if re.search(r"[.?:]$", line.text.strip()):
        return False
    # A graph's scale ("0 10 20 30 40") sits just outside the curve it labels.
    scale = bool(re.fullmatch(r"[\d\s.,–−\-×⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+", line.text.replace("\t", " "))) and words >= 2
    for h in hulls:
        if scale and h.y0 - 30 <= line.v0 and line.v1 <= h.y1 + 30:
            return True
        if not (h.y0 - 4 <= line.v0 and line.v1 <= h.y1 + 4):
            continue
        if words <= 6 and h.x0 - 4 <= line.u0 and right <= h.x1 + 4:
            return True
        if words <= 4:
            return True
    return False


def is_answer_label(text):
    """A short line with no sentence and no data: a label in the answer space."""
    words = [w for w in re.split(r"[\s|]+", text) if w]
    return (len(words) <= 4 and not re.search(r"[.?:!]$", text) and not re.search(r"\d", text)
            and not OPTION_LINE.match(text))


def is_sentence(cells):
    text = " ".join(c[2] for c in cells)
    words = [w for w in text.split() if re.search(r"[A-Za-z]{2,}", w)]
    return len(words) >= 5 or bool(re.search(r"[.?:]$", text.strip()))


# An equation or formula: an arrow, or an element symbol with a subscript.
FORMULA = re.compile(r"[→⇌]|[A-Z][a-z]?[₀-₉]")


# A state symbol followed straight by the next species: the equation's arrow
# was drawn in a way the text layer does not carry.
MISSING_ARROW = re.compile(r"\((?:g|l|s|aq)\)[ \t]+\d*(?:[A-Z][a-z]?|\[)(?![a-zᶿ])[\w₀-₉⁺⁻²³]*")


def is_answer_stub(text):
    """An answer line with its label and unit: "change in energy = ........ J".
    It is where the answer goes, not part of the question."""
    if not DOT_RUN.search(text) or FORMULA.search(text):
        return False                                     # an equation to complete is the question
    rest = clean(text.replace("\t", " "))
    return len(rest) < 40 and not re.search(r"[.?:]$", rest)


OPTION_CELL = re.compile(r"^([A-D])$")
INLINE_OPTIONS = re.compile(r"^A\s+(?P<A>\S.{0,40}?)\s+B\s+(?P<B>\S.{0,40}?)\s+C\s+(?P<C>\S.{0,40}?)\s+D\s+(?P<D>\S.{0,40})$")
OPTION_LINE = re.compile(r"^([A-D])\s+(\S.*)$")


def split_options(lines):
    """Printed multiple-choice options, and the lines that are not options.

    Options are the last unbroken run A, B, C (D) set at one indent. A stem
    sentence can open with "A" too ("A parallel plate capacitor is…"), which is
    why the run, not the letter, decides. A line between two options is the
    first one's text wrapping.
    """
    # Short options can share one line: "A 1 and 2   B 1 and 3   C 2 and 3   D 3 only".
    for i, l in enumerate(lines):
        m = INLINE_OPTIONS.match(clean(l.text.replace("\t", " ")))
        if m:
            opts = [{"letter": k, "text": m.group(k)} for k in "ABCD"]
            return opts, lines[:i] + lines[i + 1:]
    cand = []
    for i, l in enumerate(lines):
        cells = [c[2] for c in l.cells]
        if not cells:
            continue
        m = OPTION_LINE.match(cells[0])
        # A table row of options keeps its columns apart: "A | yes | no".
        if len(cells) >= 2 and OPTION_CELL.match(cells[0]):
            cand.append((i, cells[0], " | ".join(clean(c) for c in cells[1:] if clean(c)), l.u0))
        elif m and len(m.group(2)) < 160:
            cand.append((i, m.group(1), " | ".join(clean(c) for c in [m.group(2)] + cells[1:] if clean(c)), l.u0))
    best = None
    for k, first in enumerate(cand):
        if first[1] != "A":
            continue
        run = [first]
        for c in cand[k + 1:]:
            if c[1] == chr(ord(run[-1][1]) + 1) and abs(c[3] - first[3]) < 4:
                run.append(c)
            else:
                break
        if len(run) >= 3:
            best = run
    if not best:
        return None, lines
    at = {c[0]: c for c in best}
    # The last option wraps too: lines just after it, set in from its letter.
    last = best[-1][0]
    while last + 1 < len(lines) and lines[last + 1].u0 >= best[-1][3] + 6 \
            and lines[last + 1].v0 - lines[last].v1 < 12 and not is_answer_stub(lines[last + 1].text):
        last += 1
    opts, keep, cur = [], [], None
    for i, l in enumerate(lines):
        if i in at:
            cur = {"letter": at[i][1], "text": at[i][2]}
            opts.append(cur)
        elif best[0][0] < i <= last and cur is not None:
            cur["text"] = (cur["text"] + " " + clean(l.text.replace("\t", " "))).strip()
        else:
            keep.append(l)
    return opts, keep


def option_headings(lines, opts):
    """The column headings over a table of options ("anode | cathode"): up to
    two rows of short cells just above option A. Set inside the table's
    ruling, they would otherwise be dropped as a figure's labels."""
    if not opts or not opts[0].get("letter") or len(opts[0]["text"].split(" | ")) < 2:
        return []
    first = next((i for i, l in enumerate(lines) if l.cells
                  and re.match(r"\(?A\)?(?:\s|$)", l.cells[0][2])), None)
    rows = []
    for i in (first - 1, first - 2) if first else ():
        if i < 0:
            break
        cells = [clean(c[2]) for c in lines[i].cells if clean(c[2])]
        if not cells or any(len(c.split()) > 6 for c in cells) or re.search(r"[?.:]$", cells[-1]):
            break
        rows.insert(0, " | ".join(cells))
    return rows


def stacked_maths(lines):
    """Short fragments set above or below a line: the halves of a printed
    fraction or a formula, which the text layer cannot put back in order."""
    return sum(1 for l in lines
               if len(re.sub(r"\s", "", l.text)) <= 3 and re.fullmatch(r"[\w\s.+\-−=/()²³⁻⁺₀-₉⁰-⁹]+", l.text)
               and not OPTION_CELL.match(l.text.strip()))


def extract(qp_path, ms_path):
    qp, ms = pymupdf.open(qp_path), pymupdf.open(ms_path)
    board, spec = identify(qp)
    ms_board, ms_spec = identify(ms)
    board = board or ms_board
    if board is None:
        raise SystemExit("Could not tell the board from either document's specification code.")
    damaged = [name for name, doc in (("question paper", qp), ("mark scheme", ms)) if text_damaged(doc)]
    scheme = parse_ms(ms, board)
    questions, totals, cover_total, one_mark_each = parse_qp(qp, board, frozenset(scheme))
    # Marks the paper states somewhere other than beside the part: a multiple
    # choice paper that scores one mark each, or a question whose only unmarked
    # part takes what is left of the question's stated total.
    for q in questions:
        unmarked = [n for n, _ in leaves(q) if not n.marks]
        if one_mark_each:
            for n in unmarked:
                n.marks, n.marks_from = [1], "the cover: one mark each"
        elif len(unmarked) == 1 and q.q in totals:
            left = totals[q.q] - sum(sum(n.marks) for n, _ in leaves(q))
            if left > 0:
                unmarked[0].marks, unmarked[0].marks_from = [left], "the question total"
    W = qp[0].rect.width
    ink = {p.number: page_ink(p) for p in qp}
    hulls = {k: figure_hulls(v) for k, v in ink.items()}

    parts, problems = [], []
    for q in questions:
        for n, anc in leaves(q):
            opts, own = split_options(n.lines)
            prompt = lines_text(own, prompt=True, hulls=hulls)
            for head in option_headings(n.lines, opts):
                if head not in prompt:
                    prompt = (prompt + "\n" + head).strip()
            if opts is None and TICK_ANSWER.search(prompt):
                # AQA prints the options after the marks, among the answer space.
                pool = sorted(own + n.answer_lines, key=lambda l: (l.page, l.v0))
                opts, rest = tick_box_options(pool, ink)
                if opts:
                    own = [l for l in rest if l in own]
                prompt = lines_text(own, prompt=True, hulls=hulls)
            if not prompt.strip():
                # Cambridge's "(i) nucleus Z": a bare term is the whole part, not
                # a label in its answer space.
                prompt = lines_text(own, hulls=hulls) or lines_text(n.answer_lines, hulls=hulls)
            entry = scheme.get(n.key)
            if entry is None and n.roman is None and not n.children:
                finer = [k for k in scheme if k.startswith(f"{n.q}|{n.mid or ''}|") and k != n.key]
                if finer and not any(p_.key in finer for q_ in questions for p_, _ in leaves(q_)):
                    entry = {"answer": "\n".join(scheme[k]["answer"] for k in finer),
                             "guidance": "\n".join(scheme[k]["guidance"] for k in finer if scheme[k]["guidance"]),
                             "ao": " ".join(scheme[k]["ao"] for k in finer),
                             "marks": [m for k in finer for m in scheme[k]["marks"]],
                             "pages": sorted({pg for k in finer for pg in scheme[k]["pages"]}),
                             "ao_codes": sorted({c for k in finer for c in scheme[k].get("ao_codes", [])}),
                             "picture": any(scheme[k].get("picture") for k in finer),
                             "max": [m for k in finer for m in scheme[k].get("max", [])]}
            stems, holders, source = [], [], []
            path = anc + [n]
            for depth, a in enumerate(path):
                if depth:
                    pre = inherited_pre(path[depth - 1], a)
                    if pre is not None:
                        stems.append(lines_text(pre.pre, hulls=hulls))
                        holders.append((pre, pre.pre_bands))
                        source += pre.pre
                if a is not n:
                    stems.append(lines_text(a.lines, hulls=hulls))
                    holders.append((a, a.bands))
                source += a.lines
            source += n.answer_lines
            stems = [t for t in stems if t]
            here = figures_in(ink, n.bands, W)
            refs = sorted({m.group(0) for m in FIG_REF.finditer(prompt)})
            stem_refs = sorted({m.group(0) for s in stems for m in FIG_REF.finditer(s)})
            reasons, note = [], None
            if here["images"]:
                reasons.append(f"{here['images']} picture(s) in this part")
            if here["ink"] >= 3:
                reasons.append(f"drawn figure in this part ({here['ink']} strokes)")
            # "A graph is plotted of y against x" names a graph without printing
            # one: with no figure here, that is a note for the reader, not a skip.
            if refs and not here["images"] and here["ink"] < 3 and \
                    all(r.lower() in ("graph", "diagram", "photograph", "micrograph") for r in refs):
                note = "mentions a " + ", ".join(refs) + " in words: check one is printed"
                refs = []
            if refs:
                reasons.append("refers to " + ", ".join(refs))
            # A figure in a stem: the first part after it depends on it, and so
            # does any later part whose own words use it. The rest are noted.
            for holder, bands in holders:
                f = figures_in(ink, bands, W)
                if not (f["images"] or f["ink"] >= 3):
                    continue
                if leaves(holder)[0][0] is n or refs or USES_FIGURE.search(prompt):
                    if not refs:
                        reasons.append("its stem shows " + (", ".join(stem_refs) or "a figure"))
                else:
                    note = "its stem has a figure this part does not mention: check it stands without"
                break
            # "Use information from Figure 1 to answer questions 01.3 to 01.6."
            for m in USE_FIGURE_FOR.finditer("\n".join(stems + [prompt])):
                lo, hi = (tuple(int(x) for x in g.split(".")) for g in (m.group(2), m.group(3)))
                if n.mid is not None and lo <= (n.q, n.mid) <= hi:
                    reasons.append(f"its question says to use {m.group(1)} for {m.group(2)} to {m.group(3)}")
            if DRAWN_ANSWER.search(prompt):
                reasons.append("the answer is drawn or written on a figure")
            # A figure the board left out ("not reproduced here due to
            # third-party copyright restrictions") still has to be read.
            if not reasons and re.search(r"not reproduced", "\n".join(stems + [prompt]), re.I):
                note = "a figure in this question is not reproduced: check this part stands without it"
            if TICK_ANSWER.search(prompt) and not opts:
                reasons.append("the answer is ticked in boxes")
            if here["ticks"] >= 2 and not opts and TICK_WORDS.search(prompt):
                reasons.append(f"{here['ticks']} tick boxes")
            if entry and entry.get("picture"):
                reasons.append("its mark scheme answer is a picture")
            stacked = stacked_maths(n.lines)
            marks = sum(n.marks) if n.marks else None
            part = {
                "label": label_of(board, n),
                "key": n.key,
                "q": str(n.q),
                "marks": marks,
                "marks_printed": n.marks,
                "marks_from": n.marks_from,
                "extended_response": n.star or any(a.star for a in anc),
                "prompt": prompt,
                "stems": stems,
                "options": opts,
                "tables": sorted({m.group(0) for m in TABLE_REF.finditer("\n".join([prompt] + stems))}),
                "figure": here,
                "needs_figure": bool(reasons),
                "figure_note": note,
                "source": raw_text(source),
                "stacked_maths": stacked,
                "figure_reasons": reasons,
                "pages": sorted({b[0] + 1 for b in n.bands}),
                "scheme": entry,
            }
            if marks is None:
                problems.append(f"{part['label']}: no marks printed for this part")
            elif len(n.marks) > 1:
                problems.append(f"{part['label']}: {len(n.marks)} mark allocations {n.marks}")
            if entry is None:
                problems.append(f"{part['label']}: no mark scheme entry")
            elif marks is not None and entry["marks"] and sum(entry["marks"]) < marks and max(entry["marks"]) != marks:
                # A scheme may list more marking points than marks ("any three
                # from"); one that carries fewer has lost part of itself.
                part["scheme_marks_differ"] = True
                problems.append(f"{part['label']}: scheme marks {entry['marks']} vs paper {marks}")
            parts.append(part)

    per_q = collections.Counter()
    for p in parts:
        per_q[int(p["q"])] += p["marks"] or 0
    # A question whose every part carries the question's whole total is a
    # choice ("write an essay on ONE of the following"): it counts once.
    for qn, stated in totals.items():
        qparts = [p for p in parts if int(p["q"]) == qn]
        if len(qparts) >= 2 and all(p["marks"] == stated for p in qparts):
            for p in qparts:
                p["alternative"] = True
            per_q[qn] = stated
    # AQA prints a multiple-choice section's total in its last question's
    # margin box: a total that matches the run of questions since the last
    # stated one is the section's, not the question's.
    stated_qs = sorted(totals)
    for i, qn in enumerate(stated_qs):
        if per_q.get(qn, 0) != totals[qn]:
            since = stated_qs[i - 1] if i else 0
            run = sum(per_q.get(k, 0) for k in range(since + 1, qn + 1))
            if run == totals[qn]:
                totals[qn] = per_q.get(qn, 0)
    q_checks = {}
    for qn, stated in sorted(totals.items()):
        q_checks[qn] = {"stated": stated, "found": per_q.get(qn, 0)}
        if per_q.get(qn, 0) != stated:
            problems.append(f"Q{qn}: parts add to {per_q.get(qn, 0)}, the paper says {stated}")
    found = sum(per_q.values())
    keys = {p["key"] for p in parts}
    for name in damaged:
        problems.insert(0, f"the {name}'s text layer is damaged (letters missing or spaced out): "
                           "read it from the page images, not the text")
    return {
        "damaged_text": damaged,
        "board": board, "spec": spec, "ms_spec": ms_spec,
        "paper_total": cover_total, "marks_found": found,
        "reconciles": cover_total == found,
        "questions": len(questions), "question_totals": q_checks,
        "parts": parts,
        "scheme_unmatched": [k for k in scheme if k not in keys],
        "scheme": scheme,
        "problems": problems,
    }


# A fraction set in two rows comes out of the text layer as raised and lowered
# runs of letters ("V = _4πε^Q _r"); ordinary sub- and superscripts are digits
# or a single letter (Kₐ, K_p).
STACKED_SCHEME = re.compile(r"\^[A-Za-z(√𝑄-𝑧𝜋𝜀]|_[A-Za-z𝜋𝜀][^\s,.)]*\s+\^")


def text_damaged(doc):
    """A text layer whose font lost its encoding comes out letter by letter
    ("Y o u m u st a n e r"), often with letters missing. Nothing read from it
    can be trusted as verbatim."""
    words = []
    for page in list(doc)[:6]:
        words += page.get_text().split()
    if len(words) < 200:
        return False
    singles = sum(1 for w in words if len(w) == 1 and w.isalpha() and w not in "AaIBCD")
    # Spacing confined to the furniture is damage too: marks set "[ 1 ]" and
    # labels "( i i )" cannot be found, so the paper cannot be cut into parts.
    text = " ".join(words)
    spaced = len(re.findall(r"\[ \d \]|\( [ivx] (?:[ivx] )+\)", text))
    return singles / len(words) > 0.25 or spaced >= 6


def scheme_text(entry):
    if not entry:
        return None
    s = entry["answer"]
    if entry.get("max"):
        s += "\n" + " ".join(entry["max"])
    if entry["guidance"]:
        s += "\nGuidance: " + entry["guidance"]
    return s.strip() or None


def printed_spec_refs(entry):
    """Spec points an AQA scheme prints beside the marks ("AO3 4.4.2.5 RPA2"):
    a start the reader checks against the course list, not a tag to trust."""
    ao = (entry or {}).get("ao", "")
    return list(dict.fromkeys(re.findall(r"(?<![\w.])(\d+(?:\.\d+){2,4}[a-z]?)(?![\w.])", ao)))


def draft_rows(x):
    rows, skipped = [], []
    for p in x["parts"]:
        if p["needs_figure"]:
            skipped.append({"label": p["label"], "marks": p["marks"], "reason": "; ".join(p["figure_reasons"])})
            continue
        flags = ["text layer damaged: read from the page"] if x["damaged_text"] else []
        if p["marks"] is None:
            flags.append("no marks printed for this part")
        if not p["scheme"]:
            flags.append("no mark scheme entry")
        if p.get("scheme_marks_differ"):
            flags.append("mark scheme marks differ from the paper")
        if p.get("stacked_maths"):
            flags.append("stacked fraction or formula: check the order against the page")
        if p.get("figure_note"):
            flags.append(p["figure_note"])
        if MISSING_ARROW.search("\n".join(p["stems"] + [p["prompt"]])):
            flags.append("an equation's arrow is missing from the text: check against the page")
        if re.search(r"=\s*→|→\s*=", "\n".join(p["stems"] + [p["prompt"], scheme_text(p["scheme"]) or ""])):
            flags.append("a fraction bar may have become an arrow: check against the page")
        if p["scheme"] and STACKED_SCHEME.search(scheme_text(p["scheme"]) or ""):
            flags.append("mark scheme has a printed fraction or formula: check it against the page")
        rows.append({
            "label": p["label"],
            "q": p["q"],
            "shared_context": "\n".join(p["stems"]) or None,
            "prompt": p["prompt"],
            "options": p["options"],
            "marks": p["marks"],
            "mark_scheme": scheme_text(p["scheme"]),
            "command_word": None,
            "assessment_objectives": (p["scheme"] or {}).get("ao_codes", []),
            "question_format": "mcq" if p["options"] else "written",
            "specification_version": x["spec"],
            "mathematical_demand": None,
            "practical_demand": None,
            "spec_points": printed_spec_refs(p["scheme"]),
            "flags": flags,
        })
    return {"profile": "extract_paper", "rows": rows, "skipped": skipped}


def doc_text(path):
    doc = pymupdf.open(path)
    out = []
    for page in doc:
        H = page.rect.height
        body = []
        for l in visual_lines(page):
            cells = page_cells(l, H)
            t = "   |   ".join(clean(c[2]) for c in cells if clean(c[2]))
            if t and not DOTS.match(t):
                body.append(t)
        if body:
            out.append(f"=== page {page.number + 1} ===")
            out += body
    return "\n".join(out)


def report(x):
    print(f"Board {x['board']}  spec {x['spec']} (scheme {x['ms_spec']})  "
          f"questions {x['questions']}  parts {len(x['parts'])}")
    print(f"{'label':10} {'marks':>5} {'scheme':>6}  figure")
    print("-" * 90)
    for p in x["parts"]:
        sm = p["scheme"]["marks"] if p["scheme"] else None
        sm_s = "-" if sm is None else (str(sum(sm)) if sm else "?")
        print(f"{p['label']:10} {str(p['marks']):>5} {sm_s:>6}  {'; '.join(p['figure_reasons'])[:68]}")
    usable = [p for p in x["parts"] if not p["needs_figure"]]
    print(f"\n  paper total: found {x['marks_found']} of {x['paper_total']} stated"
          f" -- {'OK' if x['reconciles'] else 'CHECK'}")
    qt = x["question_totals"]
    if qt:
        print(f"  question totals: {sum(1 for v in qt.values() if v['stated'] == v['found'])}/{len(qt)} reconcile")
    print(f"  mark scheme entries matched: {sum(1 for p in x['parts'] if p['scheme'])}/{len(x['parts'])};"
          f" scheme entries with no part: {len(x['scheme_unmatched'])}")
    print(f"  {len(usable)} parts need no figure ({sum(p['marks'] or 0 for p in usable)} marks);"
          f" {len(x['parts']) - len(usable)} do")
    for pr in x["problems"][:25]:
        print("  ! " + pr)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    qp_path, ms_path = sys.argv[1], sys.argv[2]
    mode = sys.argv[3] if len(sys.argv) > 3 else "--report"
    if mode == "--text":
        print(json.dumps({"qp": doc_text(qp_path), "ms": doc_text(ms_path)}, ensure_ascii=False))
        sys.exit()
    x = extract(qp_path, ms_path)
    if mode == "--json":
        print(json.dumps(x, ensure_ascii=False, indent=1, default=list))
    elif mode == "--draft":
        print(json.dumps(draft_rows(x), ensure_ascii=False, indent=1))
    else:
        report(x)
