"""Focused regressions for extract_paper.py and check_rows.py.

    python3 -E -P -m unittest discover -s scripts/ingest-paper
"""
import unittest

import check_rows as C
import extract_paper as X


def span(text, u0, size=11.0, base=100.0, font=""):
    width = len(text) * size * 0.5
    return X.Span(text, size, False, u0, u0 + width, base - size, base + 2, base, font)


def line(cells, u0=72):
    return X.TextLine(0, 100, 112, [(u0 + 40 * i, u0 + 40 * i + 30, t) for i, t in enumerate(cells)])


class Scripts(unittest.TestCase):
    def test_lowered_digits_are_subscripts_and_raised_charges_superscripts(self):
        l = X.Line(0, [span("CaCO", 72), span("3", 98, size=7.0, base=102.5)])
        self.assertEqual(l.text, "CaCO₃")
        l = X.Line(0, [span("Fe", 72), span("3+", 84, size=7.0, base=96.0)])
        self.assertEqual(l.text, "Fe³⁺")

    def test_a_raised_o_after_I_is_the_allele_not_the_standard_sign(self):
        l = X.Line(0, [span("I", 72), span("o", 78, size=7.0, base=96.0)])
        self.assertEqual(l.text, "Iᵒ")

    def test_letters_set_low_keep_an_underscore(self):
        l = X.Line(0, [span("K", 72), span("p", 78, size=7.0, base=102.5)])
        self.assertEqual(l.text, "K_p")

    def test_symbol_and_dingbat_fonts(self):
        self.assertEqual(X.glyphs("H", "Symbol"), "ΔH")
        self.assertEqual(X.glyphs("", "Wingdings-Regular"), "✓")
        self.assertEqual(X.glyphs("P", "Wingdings2"), "✓")
        self.assertEqual(X.glyphs("o", "SymbolMT"), "→")
        self.assertEqual(X.glyphs("U", "EuclidExtra"), "⇌")
        self.assertEqual(X.glyphs("Ultimately", "EuclidExtra"), "Ultimately")
        self.assertEqual(X.glyphs("\x16 \x1a", "MonotypeSorts"), "✓ ✗")
        self.assertEqual(X.glyphs("Step 1\x07A sample", "Arial"), "Step 1 A sample")


class Labels(unittest.TestCase):
    W = 595

    def stack(self, q=None, letter=None, roman=None):
        qn = X.Node(q) if q else None
        ln = X.Node(q, letter) if letter else None
        rn = X.Node(q, letter, roman) if roman else None
        return [qn, ln, rn]

    def test_a_question_number_must_be_next_and_in_question_ones_margin(self):
        st = self.stack(1, "b")
        self.assertEqual(X.read_label("ocr", (50, 60, "2 This question"), self.W, st, 1, 50)[0], 2)
        self.assertIsNone(X.read_label("ocr", (50, 60, "3 Skipped one"), self.W, st, 1, 50))
        # a table row starting "2" further in is not question 2
        self.assertIsNone(X.read_label("ocr", (75, 80, "2 1.20"), self.W, st, 1, 50))

    def test_letters_follow_in_order_and_a_lone_i_is_roman(self):
        st = self.stack(3, "a")
        self.assertEqual(X.read_label("cambridge", (72, 80, "(b) Explain"), self.W, st, 3)[1], "b")
        self.assertIsNone(X.read_label("cambridge", (72, 80, "(d) Explain"), self.W, st, 3))
        q, letter, roman, rest, _ = X.read_label("cambridge", (96, 100, "(i) Calculate"), self.W, st, 3)
        self.assertEqual((letter, roman, rest), (None, "i", "Calculate"))

    def test_extended_response_star_after_the_bracket(self):
        q, letter, roman, rest, star = X.read_label("ocr", (72, 80, "(a)* Explain fully"), self.W,
                                                    self.stack(22), 22)
        self.assertEqual((letter, star, rest), ("a", True, "Explain fully"))

    def test_aqa_boxed_labels(self):
        st = self.stack(1)
        st[1] = X.Node(1, 3)
        self.assertEqual(X.read_label("aqa", (53, 60, "0 1 . 4 Deduce"), self.W, st, 1)[1], 4)
        self.assertEqual(X.read_label("aqa", (53, 60, "0 2 Figure 1 shows"), self.W, st, 1)[0], 2)


class SchemeLabels(unittest.TestCase):
    def test_aqa_with_and_without_the_leading_zero(self):
        self.assertEqual(X.ms_key("aqa", "2.1", (None, None))[0], "2|1|")
        self.assertEqual(X.ms_key("aqa", "01.4", (None, None))[0], "1|4|")
        self.assertEqual(X.ms_key("aqa", "10.2", (None, None))[0], "10|2|")

    def test_ocr_unbracketed_labels_and_answer_text_after_them(self):
        key, carry, rest = X.ms_key("ocr", "1 a i A = vacuole", (None, None))
        self.assertEqual((key, rest), ("1|a|i", "A = vacuole"))
        self.assertEqual(X.ms_key("ocr", "ii", (1, "a"))[0], "1|a|ii")
        self.assertIsNone(X.ms_key("ocr", "a protein", (1, "a")))

    def test_ocr_numbered_items_belong_to_their_numeral(self):
        key, _, rest = X.ms_key("ocr", "(ii)1 I = 1.25 (A)", (21, "b"))
        self.assertEqual((key, rest), ("21|b|ii", "1 I = 1.25 (A)"))
        self.assertEqual(X.ms_key("ocr", "22 (a) (i)1 0.5", (None, None))[0], "22|a|i")

    def test_a_label_set_high_is_still_a_label(self):
        self.assertEqual(X.ms_key("cambridge", "^2(b)(ii)", (2, "b"))[0], "2|b|ii")

    def test_letter_and_numeral_in_one_bracket(self):
        self.assertEqual(X.ms_key("edexcel", "1(ai)", (None, None))[0], "1|a|i")

    def test_a_bracketed_i_alone_continues_the_letter_above(self):
        self.assertEqual(X.ms_key("edexcel", "(i)", (3, "b"))[0], "3|b|i")


class SpecRefs(unittest.TestCase):
    def test_spec_refs_printed_in_the_ao_column(self):
        self.assertEqual(X.printed_spec_refs({"ao": "AO3 4.4.2.5 RPA2"}), ["4.4.2.5"])
        self.assertEqual(X.printed_spec_refs({"ao": "AO1.1a 2.1 3.6.2.1"}), ["3.6.2.1"])
        self.assertEqual(X.printed_spec_refs(None), [])


class Options(unittest.TestCase):
    def test_a_stem_opening_with_a_is_not_option_a(self):
        lines = [line(["A parallel plate capacitor is connected across a battery."]),
                 line(["What is the energy now stored?"]),
                 line(["A 0.5E"], 93), line(["B E"], 93), line(["C 2E"], 93), line(["D 4E"], 93)]
        opts, keep = X.split_options(lines)
        self.assertEqual([o["letter"] for o in opts], ["A", "B", "C", "D"])
        self.assertEqual(opts[0]["text"], "0.5E")
        self.assertEqual(len(keep), 2)

    def test_a_wrapped_tick_box_option_is_one_option(self):
        self.assertTrue(X.wraps_on("With a point quadrat, a plant that is smaller than half a square",
                                   "is more likely to be counted."))
        self.assertFalse(X.wraps_on("y = mc + x", "y = mc² + x"))
        self.assertFalse(X.wraps_on("Liver.", "pancreas"))
        self.assertFalse(X.wraps_on("cornea", "iris"))
        self.assertTrue(X.wraps_on("Measure the intensity of colour produced from", "a biuret test."))

    def test_answer_stubs_and_missing_arrows(self):
        self.assertTrue(X.is_answer_stub("change in energy = ............ J"))
        self.assertFalse(X.is_answer_stub("Explain why ........ is used."))
        self.assertTrue(X.MISSING_ARROW.search("C₂H₅OH(g) C₂H₄(g) + H₂O(g)"))
        self.assertFalse(X.MISSING_ARROW.search("C₂H₅OH(g) → C₂H₄(g) + H₂O(g)"))


class Checking(unittest.TestCase):
    def test_normalising_ignores_scripts_spacing_and_punctuation(self):
        self.assertEqual(C.norm("CaCO₃(s) → CaO(s)"), C.norm("CaCO3 (s) CaO (s)"))

    def test_scheme_marks_never_count(self):
        pieces = [p for p, _ in C.chunks("2H2 + O2 → 2H2O (2)\nGuidance: allow multiples (1)", scheme=True)]
        self.assertEqual(pieces[0].strip(), "2H2 + O2 → 2H2O")

    def test_raised_atom_counts_are_caught_but_charges_are_not(self):
        for bad in ("C⁸H¹⁸", "2H²SO⁴", "CH₃CH²OH"):
            self.assertTrue(C.raised_formula(bad), bad)
        for ok in ("Fe²⁺", "SO₄²⁻", "O²⁻", "mol dm⁻³", "J K⁻¹ mol⁻¹", "¹³C NMR", "C₈H₁₈",
                   "K_c = RS³/P²Q × 1/V", "⁷⁹Br⁷⁹Br OR ⁷⁹Br₂", "(CF₂³⁷Cl⁸¹Br)⁺"):
            self.assertFalse(C.raised_formula(ok), ok)

    def test_italic_l_gap_and_standard_sign(self):
        self.assertEqual(X.clean("KCl O₄ and HCl (aq) and Cl ₂"), "KClO₄ and HCl(aq) and Cl₂")
        self.assertEqual(X.clean("Al Thomas"), "Al Thomas")
        self.assertTrue(C.contains(C.words("E 0.34 V"), "Eᶿ 0.34 V"))

    def test_words_must_all_be_in_the_bag(self):
        bag = C.words("5.450 (1) x 100\n5.600\n= 97.3214")
        self.assertTrue(C.contains(bag, "5.450 / 5.600 x 100 = 97.3214"))
        self.assertFalse(C.contains(bag, "5.450 / 5.700 x 100"))


if __name__ == "__main__":
    unittest.main()
