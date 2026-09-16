"""Focused regressions: python -m unittest discover -s scripts/ingest-paper."""
import unittest

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject

from split_paper import PROFILES, fix_units, parse_questions, without_draft_watermark


class TextCleanupTests(unittest.TestCase):
    def test_kerning_preserves_case_and_adjacent_words(self):
        self.assertEqual(
            fix_units("The par ticle. Par ticles and par ticles on sur faces."),
            "The particle. Particles and particles on surfaces.",
        )
        prose = "IN THIS AREA the value is given. Explain the experiment."
        self.assertEqual(fix_units(prose), prose)

    def test_total_removed_without_changing_marks_or_labels(self):
        rows = parse_questions(
            "4 (c) Describe how her speed could be determined.\n(3)\n"
            "( Total for Question 4 = 10 marks)\n",
            PROFILES["edexcel"],
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["label"], "4(c)")
        self.assertEqual(rows[0]["marks"], 3)
        self.assertEqual(rows[0]["prompt"], "Describe how her speed could be determined.")
        self.assertEqual(rows[0]["flags"], [])

    def test_unremoved_debris_is_not_clean(self):
        rows = parse_questions(
            "4 (c) Describe how her speed could be determined.\n(3)\nDeR AFTxe\n",
            PROFILES["edexcel"],
        )
        self.assertIn("watermark residue", rows[0]["flags"])


class WatermarkTests(unittest.TestCase):
    def page(self, content):
        writer = PdfWriter()
        page = writer.add_blank_page(width=600, height=800)
        stream = DecodedStreamObject()
        stream.set_data(content)
        page[NameObject("/Contents")] = stream
        return page

    def test_removes_only_confirmed_watermark_and_keeps_source(self):
        content = b"""
BT 84 85 -85 84 0 0 Tm [(DR) -5 (AFT)] TJ ET
BT 84 85 -85 84 0 0 Tm [(e) 3 (x) 15 (emplar)] TJ ET
BT 84 85 -85 84 0 0 Tm (D) Tj ET
BT 84 85 -85 84 0 0 Tm (e) Tj ET
BT 1 0 0 1 0 0 Tm (Reason IN THIS AREA exemplar) Tj ET
BT 0 12 -12 0 0 0 Tm (DO NOT WRITE IN THIS AREA) Tj ET
BT 12 .1 -.1 12 0 0 Tm (balance) Tj ET
BT 8 8 -8 8 0 0 Tm (e) Tj ET
"""
        page = self.page(content)
        cleaned = without_draft_watermark(page)
        shows = [args[0] for args, op in cleaned.get_contents().operations if op == b"Tj"]
        self.assertEqual(shows, ["Reason IN THIS AREA exemplar", "DO NOT WRITE IN THIS AREA", "balance", "e"])
        self.assertFalse(any(op == b"TJ" for _, op in cleaned.get_contents().operations))
        self.assertEqual(page.get_contents().get_data(), content)

    def test_diagonal_letters_alone_are_not_a_watermark(self):
        page = self.page(b"BT 84 85 -85 84 0 0 Tm (e) Tj (D) Tj ET")
        self.assertIs(without_draft_watermark(page), page)


if __name__ == "__main__":
    unittest.main()
