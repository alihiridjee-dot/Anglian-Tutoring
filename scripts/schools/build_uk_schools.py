"""
Builds public/uk-schools.json, the list behind the school picker in onboarding.

It holds every open UK school or college a GCSE or A-level student could be at:
secondaries, sixth forms, FE colleges, independents, special schools and pupil
referral units. Primaries are left out on purpose. They would triple the list
and bury the right answer under hundreds of "St Mary's" primaries.

Each nation publishes its own register, so there are four sources:

  England   DfE "Get Information About Schools" (GIAS), the full daily extract.
            https://get-information-schools.service.gov.uk/Downloads
            Kept: open, statutory high age 15 or over. Its "Welsh establishment"
            rows have no ages, so Wales comes from its own list instead.
  Wales     Welsh Government "Address list of schools".
            https://www.gov.wales/address-list-schools
            Kept: secondary, middle (all-through) and special maintained
            schools, plus independents unless the name says primary or prep
            (the list gives no ages).
  Scotland  Scottish Government "School contact details" and the "Register of
            independent schools".
            https://www.gov.scot/publications/school-contact-details/
            https://www.gov.scot/publications/independent-schools-in-scotland-register/
            Kept: schools with a secondary department, special schools that
            aren't for primary age, and independents that teach secondary age.
  NI        DE "Examination performance at post-primary schools" (SAER). It is
            the only current open list of NI post-primary schools; the
            OpenDataNI school census files stop in 2016.
            https://admin.opendatani.gov.uk/dataset?q=SAER
            Plus the six regional FE colleges, which no open list covers.

All four are under the Open Government Licence v3.0.

Re-run once a year (September is when the registers settle). The GIAS link is
dated, so it follows today's date. The others change name with each release:
open the pages above and paste the new download links into SOURCES. Run:

  python3 scripts/schools/build_uk_schools.py

Standard library only. Spreadsheets are read straight from their zip XML.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from pathlib import Path

SOURCES = {
    "wales": "https://www.gov.wales/sites/default/files/publications/2026-04/address-list-schools-values.ods",
    "scotland": "https://www.gov.scot/binaries/content/documents/govscot/publications/factsheet/2019/03/school-contact-details/documents/school-contact-details/school-contact-details/govscot%3Adocument/school%2Bcontact%2Blist%2B31%2BJuly%2B2026.xlsx",
    "scotland_independent": "https://www.gov.scot/binaries/content/documents/govscot/publications/factsheet/2017/11/independent-schools-in-scotland-register/documents/registered-independent-schools-in-scotland/registered-independent-schools-in-scotland/govscot%3Adocument/Register%252Bof%252Bindependent%252Bschools%252BAugust%252B2026%252Bupdate.xlsx",
    "ni": "https://admin.opendatani.gov.uk/dataset/b1b1d51e-6986-4930-96d6-4b126916b0b1/resource/0c539049-cdbb-41a5-bbd8-babb2488cda5/download/saer-2425-opendatani.ods",
}

GIAS_URL = "https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/edubasealldata{date}.csv"

# Northern Ireland's regional colleges, by their main campus town.
NI_FE_COLLEGES = [
    ("Belfast Metropolitan College", "Belfast"),
    ("Northern Regional College", "Ballymena"),
    ("North West Regional College", "Derry"),
    ("South Eastern Regional College", "Bangor"),
    ("Southern Regional College", "Newry"),
    ("South West College", "Enniskillen"),
]

# GIAS types that are open and teach older pupils but aren't a student's school:
# overseas schools, universities, nurseries, secure units and the like.
GIAS_SKIP_TYPES = {
    "Welsh establishment",
    "British schools overseas",
    "Offshore schools",
    "Service children's education",
    "Higher education institutions",
    "Local authority nursery school",
    "Miscellaneous",
    "Secure units",
}

OUT = Path(__file__).resolve().parents[2] / "public" / "uk-schools.json"

ATTRIBUTION = (
    "Contains public sector information licensed under the Open Government Licence v3.0, "
    "from the Department for Education, the Welsh Government, the Scottish Government "
    "and the Department of Education (Northern Ireland)."
)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as res:
        return res.read()


def tidy(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


# All-caps words in the registers that are acronyms, not shouting.
ACRONYMS = {"MEPA", "SALT"}
SMALL_WORDS = {"of", "and", "the", "for", "y"}


def title_case(name: str) -> str:
    """CARDIFF HIGH SCHOOL → Cardiff High School, leaving JFS and K-HQ alone.

    A few registers (mostly Wales) record some names in capitals. Words with
    no vowel are taken as acronyms; Welsh "y" stays lower case mid-name, as in
    Ysgol y Creuddyn.
    """
    words = []
    for i, word in enumerate(name.split(" ")):
        parts = []
        for j, part in enumerate(word.split("-")):
            lower = part.lower()
            if part in ACRONYMS or not re.search(r"[AEIOUY]", part) or len(part) == 1 and part != "Y":
                parts.append(part)
            elif (i or j) and lower in SMALL_WORDS:
                parts.append(lower)
            else:
                parts.append(lower[:1].upper() + lower[1:])
        words.append("-".join(parts))
    return " ".join(words)


# ── Spreadsheet readers ─────────────────────────────────────────────────────


def xlsx_sheets(data: bytes) -> list[list[dict[str, str]]]:
    """Every sheet as rows of {column letter: text}, in workbook order."""
    z = zipfile.ZipFile(io.BytesIO(data))
    m = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{m}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{m}t")))
    names = sorted(
        (n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
        key=lambda n: int(re.search(r"\d+", n).group()),
    )
    sheets = []
    for name in names:
        rows = []
        for r in ET.fromstring(z.read(name)).iter(f"{m}row"):
            row = {}
            for c in r.iter(f"{m}c"):
                col = re.match(r"[A-Z]+", c.get("r")).group()
                v = c.find(f"{m}v")
                kind = c.get("t")
                if kind == "s" and v is not None:
                    row[col] = shared[int(v.text)]
                elif kind == "inlineStr":
                    row[col] = "".join(t.text or "" for t in c.iter(f"{m}t"))
                else:
                    row[col] = v.text if v is not None and v.text else ""
            rows.append(row)
        sheets.append(rows)
    return sheets


def ods_tables(data: bytes) -> dict[str, list[list[str]]]:
    """Every table as rows of cell text, keyed by table name."""
    z = zipfile.ZipFile(io.BytesIO(data))
    t = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
    p = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
    tables = {}
    for table in ET.fromstring(z.read("content.xml")).iter(f"{t}table"):
        rows = []
        for r in table.iter(f"{t}table-row"):
            cells: list[str] = []
            for c in r.findall(f"{t}table-cell"):
                # Trailing empty cells are stored as one cell repeated
                # thousands of times; cap it, nothing real is that wide.
                repeat = min(int(c.get(f"{t}number-columns-repeated", "1")), 64)
                text = " ".join("".join(x.itertext()) for x in c.findall(f"{p}p"))
                cells.extend([text] * repeat)
            rows.append(cells)
        tables[table.get(f"{t}name")] = rows
    return tables


def header_rows(rows: list[list[str]], first: str) -> list[dict[str, str]]:
    """Rows below the header row whose first cell is `first`, keyed by header."""
    at = next(i for i, r in enumerate(rows) if r and tidy(r[0]) == first)
    head = [tidy(h) for h in rows[at]]
    return [dict(zip(head, r)) for r in rows[at + 1 :] if r and tidy(r[0])]


# ── One reader per nation ───────────────────────────────────────────────────


def england() -> list[tuple[str, str]]:
    # Today's extract can lag by a day around midnight, so fall back a few days.
    for back in range(5):
        day = (dt.date.today() - dt.timedelta(days=back)).strftime("%Y%m%d")
        try:
            raw = fetch(GIAS_URL.format(date=day))
            break
        except Exception:
            continue
    else:
        sys.exit("Couldn't download the GIAS extract for any of the last five days.")

    # GIAS is Windows-1252: its apostrophes are byte 0x92, which isn't UTF-8.
    rows = csv.DictReader(io.StringIO(raw.decode("cp1252", errors="replace")))
    out = []
    for r in rows:
        if not r["EstablishmentStatus (name)"].startswith("Open"):
            continue
        if r["TypeOfEstablishment (name)"] in GIAS_SKIP_TYPES:
            continue
        try:
            high = int(r["StatutoryHighAge"])
        except ValueError:
            high = None
        # A few post-16 colleges record no ages at all; keep those.
        if high is not None and high < 15:
            continue
        if high is None and "16" not in r["TypeOfEstablishment (name)"]:
            continue
        out.append((r["EstablishmentName"], r["Town"] or r["LA (name)"]))
    return out


def wales() -> list[tuple[str, str]]:
    tables = ods_tables(fetch(SOURCES["wales"]))
    out = []
    for r in header_rows(tables["Maintained"], "School Number"):
        if r["Sector"] in ("Secondary", "Middle", "Special"):
            out.append((r["School Name"], r["Local Authority"]))
    # Independents come with no ages, so only the name can rule out a primary.
    for r in header_rows(tables["Independent"], "School Number"):
        if not re.search(r"primary|prep|nursery|infant", r["School Name"], re.I):
            out.append((r["School Name"], r["Local Authority"]))
    return out


def scotland() -> list[tuple[str, str]]:
    # Sheet 3 is "Publicly funded schools open"; its header is the row that
    # starts "Seed Code".
    rows = xlsx_sheets(fetch(SOURCES["scotland"]))[2]
    at = next(i for i, r in enumerate(rows) if tidy(r.get("A", "")) == "Seed Code")
    head = {k: tidy(v) for k, v in rows[at].items()}
    out = []
    for raw in rows[at + 1 :]:
        r = {head.get(k, k): v for k, v in raw.items()}
        if not tidy(r.get("School Name", "")):
            continue
        # Special schools don't record an age range. Those for younger children
        # either have a primary department or, in Glasgow, carry no department
        # flag at all and are named "… Primary School".
        secondary = r.get("Secondary Department") == "Yes"
        special_older = (
            r.get("Special Department") == "Yes"
            and r.get("Primary Department") != "Yes"
            and "primary" not in r["School Name"].lower()
        )
        if secondary or special_older:
            out.append((r["School Name"], scottish_area(r)))

    # The register's "Primary / Secondary education" column is free text:
    # "All through", "Secondary", "Age specific: 11-18", "Preparatory"...
    for r in xlsx_sheets(fetch(SOURCES["scotland_independent"]))[0][1:]:
        name, stage = tidy(r.get("A", "")), tidy(r.get("H", ""))
        if not name:
            continue
        ages = [int(n) for n in re.findall(r"\d+", stage)]
        if re.search(r"secondary|all.?through", stage, re.I) or (ages and max(ages) >= 15):
            out.append((name, scottish_town(r.get("D", ""))))
    return out


def scottish_area(r: dict[str, str]) -> str:
    """The council area, or the town for the few grant-aided schools that have none."""
    if not r["LA Name"].lower().startswith("grant"):
        return r["LA Name"]
    # Their third address line is the town (GLASGOW) or a county (WEST
    # LOTHIAN); when it's a county, the town is on the line above.
    line2, line3 = tidy(r.get("Address Line2", "")), tidy(r.get("Address Line3", ""))
    town = line2 if not line3 or re.search(r"(lothian|shire)$", line3, re.I) else line3
    return title_case(town) if town.isupper() else town


def scottish_town(address: str) -> str:
    """The last address part before the postcode: "…, Paisley, PA2 7BU" → "Paisley"."""
    postcode = r"\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b"
    parts = [tidy(re.sub(postcode, "", p)) for p in re.split(r"[,\n]", address)]
    parts = [p for p in parts if p]
    return parts[-1] if parts else ""


def northern_ireland() -> list[tuple[str, str]]:
    rows = ods_tables(fetch(SOURCES["ni"]))["SAER"]
    out = []
    for r in rows:
        if not r or not tidy(r[0]).isdigit():
            continue
        # SAER names carry the town after a comma: "St Ronan's College, Lurgan".
        name, _, town = tidy(r[1]).rpartition(", ")
        out.append((name, town) if name else (town, ""))
    return out + NI_FE_COLLEGES


def main() -> None:
    nations = {
        "England": england(),
        "Wales": wales(),
        "Scotland": scotland(),
        "Northern Ireland": northern_ireland(),
    }
    rows = [(tidy(n), tidy(p)) for nation in nations.values() for n, p in nation]

    # GIAS spells one town several ways ("Newcastle Under Lyme",
    # "Newcastle-under-Lyme"); use whichever spelling it uses most.
    spellings: dict[str, Counter[str]] = {}
    for _, place in rows:
        spellings.setdefault(re.sub(r"[\s-]+", " ", place.lower()), Counter())[place] += 1
    usual = {k: c.most_common(1)[0][0] for k, c in spellings.items()}

    seen = set()
    schools = []
    for name, place in rows:
        place = usual[re.sub(r"[\s-]+", " ", place.lower())]
        key = (title_case(name) if name.isupper() else name, place)
        if key[0] and key not in seen:
            seen.add(key)
            schools.append(list(key))
    schools.sort(key=lambda s: (s[0].lower(), s[1].lower()))

    OUT.write_text(
        json.dumps(
            {
                "generated": dt.date.today().isoformat(),
                "attribution": ATTRIBUTION,
                "schools": schools,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    for nation, rows in nations.items():
        print(f"{nation:17} {len(rows):6}")
    print(f"{'Written':17} {len(schools):6}  → {OUT}")


if __name__ == "__main__":
    main()
