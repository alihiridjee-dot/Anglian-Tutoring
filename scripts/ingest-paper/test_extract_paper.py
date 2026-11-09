"""Focused regressions for extract_paper.py and check_rows.py.

    python3 -E -P -m unittest discover -s scripts/ingest-paper
"""
import unittest

import pymupdf

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

    def test_a_fraction_only_when_its_digits_stand_alone(self):
        self.assertEqual(X.tidy("¹₂O₂"), "½O₂")
        self.assertEqual(X.tidy("¹⁰³₄₅Rh"), "¹⁰³₄₅Rh")

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

    def test_edexcel_glued_and_spaced_letter_numeral(self):
        # Pearson can print "3ai", "1 biii", or "2(c i)".
        self.assertEqual(X.ms_key("edexcel", "3ai", (None, None))[0], "3|a|i")
        self.assertEqual(X.ms_key("edexcel", "1 biii", (1, "b"))[0], "1|b|iii")
        self.assertEqual(X.ms_key("edexcel", "2bii", (2, "b"))[0], "2|b|ii")
        self.assertEqual(X.ms_key("edexcel", "2(c i)", (2, "b"))[0], "2|c|i")
        self.assertEqual(X.ms_key("edexcel", "2(b(ii)", (2, "b"))[0], "2|b|ii")
        self.assertIsNone(X.ms_key("edexcel", "abi", (2, "b")))

    def test_a_bracketed_i_alone_continues_the_letter_above(self):
        self.assertEqual(X.ms_key("edexcel", "(i)", (3, "b"))[0], "3|b|i")

    def test_ocr_starred_letter_and_raised_bracket(self):
        # OCR stars a levels-marked part ("c*"), and can set "(c)" a little high.
        self.assertEqual(X.ms_key("ocr", "c*", (20, "b"))[0], "20|c|")
        self.assertEqual(X.ms_key("ocr", "^(c)", (19, "b"))[0], "19|c|")

    def test_guidance_naming_a_question_is_not_a_header(self):
        self.assertIsNone(X.header_cells(X.Line(0, [span("if no answer to question 01.6", 300)])))
        self.assertIsNotNone(X.header_cells(X.Line(0, [span("Question", 48), span("Answers", 150),
                                                       span("Mark", 450)])))


def scheme_doc(pages):
    """A mark scheme drawn from scratch: each page is (texts, rules), texts as
    (x, baseline y, text) and rules as (x0, y0, x1, y1)."""
    doc = pymupdf.open()
    for texts, rules in pages:
        page = doc.new_page(width=595, height=842)
        for x0, y0, x1, y1 in rules:
            page.draw_line((x0, y0), (x1, y1), width=0.5)
        for x, y, t in texts:
            page.insert_text((x, y), t, fontsize=10)
    return doc


# Columns of an AQA-style table: Question | Answers | Extra information | Mark | AO.
GRID_X = (43, 102, 272, 442, 485, 550)
HEADER = [(48, 122, "Question"), (150, 122, "Answers"), (300, 122, "Extra information"), (450, 122, "Mark"),
          (500, 122, "AO")]


def grid(top, bottom, borders):
    """The table's columns from top to bottom, and a full-width border at each height."""
    return [(x, top, x, bottom) for x in GRID_X] + [(GRID_X[0], v, GRID_X[-1], v) for v in [top, *borders, bottom]]


class SchemeRows(unittest.TestCase):
    def test_a_small_table_inside_an_answer_cell_does_not_split_the_part(self):
        # 01.2's label is centred in a tall cell whose answer holds a small ruled
        # table; the lines above that table are 01.2's, not 01.1's.
        texts = HEADER + [(48, 160, "01.1"), (108, 155, "distillation"), (450, 155, "1"),
                          (108, 220, "colourless"), (108, 240, "toxic"), (450, 220, "1"),
                          (115, 275, "Number of answers"), (48, 330, "01.2"), (115, 295, "4"),
                          (108, 420, "any order applies")]
        inner = [(108, v, 437, v) for v in (262, 280, 300, 318)] + [(x, 262, x, 318) for x in (108, 201, 437)]
        ms = X.parse_ms(scheme_doc([(texts, grid(110, 500, [130, 190]) + inner)]), "aqa")
        self.assertEqual(ms["1|1|"]["answer"], "distillation")
        for words in ("colourless", "toxic", "Number of answers", "any order applies"):
            self.assertIn(words, ms["1|2|"]["answer"])

    def test_levels_bands_beside_a_tall_question_cell_are_that_parts(self):
        # The levels table is ruled across the answer and mark columns only:
        # the question and AO cells span all of it, with 06.1 set halfway down.
        texts = HEADER + [(48, 160, "05.7"), (108, 155, "0.035 (m3)"), (450, 155, "1"),
                          (108, 215, "Level 3: a valid outcome"), (450, 215, "5-6"),
                          (108, 255, "Level 2: not necessarily valid"), (450, 255, "3-4"),
                          (48, 330, "06.1"), (108, 330, "Indicative content"), (108, 350, "three test tubes")]
        bands = [(GRID_X[1], v, GRID_X[4], v) for v in (235, 275)]
        ms = X.parse_ms(scheme_doc([(texts, grid(110, 500, [130, 190]) + bands)]), "aqa")
        self.assertEqual(ms["5|7|"]["answer"], "0.035 (m3)")
        self.assertIn("Level 3: a valid outcome", ms["6|1|"]["answer"])
        self.assertIn("Level 2: not necessarily valid", ms["6|1|"]["answer"])
        self.assertIn("three test tubes", ms["6|1|"]["answer"])

    def test_the_running_heads_rule_is_not_a_row_border(self):
        # A part carried to the top of the next page: the page's own rule under
        # the running head crosses its first line.
        first = (HEADER + [(48, 160, "02.3"), (108, 155, "Rearranging"), (450, 155, "3")],
                 grid(110, 300, [130]))
        # The footer's rule across the table's foot still parts the page number off.
        second = ([(108, 62, "GMm over d"), (48, 80, "02.4"), (108, 80, "= mv squared"), (450, 80, "3"),
                   (108, 120, "Correct conclusion = Titania"), (48, 292, "14")],
                  grid(52, 300, []) + [(0, 68, 595, 68), (0, 280, 595, 280)])
        ms = X.parse_ms(scheme_doc([first, second]), "aqa")
        self.assertEqual(ms["2|3|"]["answer"], "Rearranging")
        self.assertEqual(ms["2|4|"]["answer"].split("\n")[0], "GMm over d")
        self.assertNotIn("14", ms["2|4|"]["answer"])

    def test_a_misprinted_question_number_is_the_next_part_of_the_question_in_hand(self):
        texts = HEADER + [(48, 150, "01.3"), (108, 150, "evaporate"), (48, 190, "08.1"), (108, 190, "acid"),
                          (48, 230, "08.2"), (108, 230, "Ca(NO3)2"), (48, 270, "01.3"), (108, 270, "Level 3: method"),
                          (48, 310, "09.1"), (108, 310, "magnesium")]
        ms = X.parse_ms(scheme_doc([(texts, grid(110, 330, [130, 170, 210, 250, 290]))]), "aqa")
        self.assertEqual(ms["1|3|"]["answer"], "evaporate")
        self.assertEqual(ms["8|3|"]["answer"], "Level 3: method")
        self.assertEqual(ms["9|1|"]["answer"], "magnesium")

    def test_ocr_borders_that_leave_the_question_column_open_still_cut(self):
        # OCR rules each part's row from the answer column rightwards only.
        texts = [(48, 122, "Question"), (150, 122, "Answer"), (450, 122, "Marks"), (500, 122, "Guidance"),
                 (48, 160, "1 (a)"), (150, 160, "first answer"), (450, 160, "1"),
                 (60, 210, "(b)"), (150, 210, "second answer"), (450, 210, "1")]
        rules = [(x, 110, x, 300) for x in (43, 102, 442, 485, 550)] + \
                [(43, 110, 550, 110), (43, 130, 550, 130), (102, 190, 550, 190), (43, 300, 550, 300)]
        ms = X.parse_ms(scheme_doc([(texts, rules)]), "ocr")
        self.assertEqual(ms["1|a|"]["answer"], "first answer")
        self.assertEqual(ms["1|b|"]["answer"], "second answer")


OCR_HEADER = [(48, 122, "Question"), (150, 122, "Answer"), (450, 122, "Marks"), (500, 122, "Guidance")]
OCR_RULES = [(x, 110, x, 320) for x in (43, 102, 442, 485, 550)] + [(43, 110, 550, 110), (43, 130, 550, 130),
                                                                     (43, 320, 550, 320)]


class SchemeLabelsInCells(unittest.TestCase):
    def test_a_two_digit_question_number_wrapped_in_its_cell(self):
        # "18" set as "1" over "8" in a narrow question column, after question 17.
        texts = OCR_HEADER + [(48, 160, "17 (a)"), (150, 160, "first answer"), (450, 160, "1"),
                              (48, 220, "1 (a) (i)"), (150, 220, "second answer"), (450, 220, "2"),
                              (48, 232, "8"), (150, 244, "more of the second")]
        ms = X.parse_ms(scheme_doc([(texts, OCR_RULES + [(102, 190, 550, 190)])]), "ocr")
        self.assertIn("second answer", ms["18|a|i"]["answer"])
        self.assertIn("more of the second", ms["18|a|i"]["answer"])
        self.assertNotIn("1|a|i", ms)

    def test_a_letter_set_below_its_numeral(self):
        # "(i)" over "(b)" is (b)(i) when (b) is due; "(ii)" over "(b)" is (b)(ii).
        texts = OCR_HEADER + [(48, 150, "16 (a) (i)"), (150, 150, "metaphase"), (450, 150, "1"),
                              (75, 175, "(ii)"), (150, 175, "single cell"), (450, 175, "4"),
                              (75, 210, "(i)"), (150, 210, "cell B measured"), (450, 210, "3"),
                              (48, 226, "(b)"), (150, 236, "1.7 (± 0.4)"),
                              (75, 270, "(ii)"), (150, 270, "light microscope"), (450, 270, "2"),
                              (48, 286, "(b)"), (150, 296, "colour visible")]
        rules = OCR_RULES + [(102, v, 550, v) for v in (165, 190, 255)]
        ms = X.parse_ms(scheme_doc([(texts, rules)]), "ocr")
        self.assertEqual(ms["16|a|i"]["answer"], "metaphase")
        self.assertEqual(ms["16|a|ii"]["answer"], "single cell")
        self.assertIn("1.7 (± 0.4)", ms["16|b|i"]["answer"])
        self.assertIn("colour visible", ms["16|b|ii"]["answer"])
        self.assertNotIn("16|b|", ms)

    def test_a_first_numeral_over_the_next_letter_needs_its_own_first(self):
        # "(i)" over "(b)" is (a)(i) when (a) has no (i) yet: (b) is a part of its own.
        texts = OCR_HEADER + [(48, 150, "16 (a)"), (150, 150, "stem only"),
                              (75, 210, "(i)"), (150, 210, "first numeral"), (450, 210, "1"),
                              (48, 226, "(b)"), (150, 226, "next letter"), (450, 226, "1")]
        ms = X.parse_ms(scheme_doc([(texts, OCR_RULES + [(102, 190, 550, 190)])]), "ocr")
        self.assertIn("first numeral", ms["16|a|i"]["answer"])
        self.assertIn("next letter", ms["16|b|"]["answer"])

    def test_a_table_under_the_header_lends_it_no_columns(self):
        # A small table opening the first answer starts on the header's bottom
        # rule; its rules must not move the answer column.
        texts = [(48, 122, "Question"), (257, 122, "Answer"), (450, 122, "Marks"), (490, 122, "Guidance"),
                 (48, 150, "1 (a)"), (150, 150, "Somatic"), (300, 150, "Germ-line"), (450, 150, "2"),
                 (108, 200, "2 money from tourists")]
        inner = [(x, 127, x, 180) for x in (120, 250, 380)]
        header = [(x, 110, x, 127) for x in (43, 102, 442, 485, 550)]
        body = [(x, 127, x, 320) for x in (43, 102, 442, 485, 550)]
        ms = X.parse_ms(scheme_doc([(texts, header + body + inner + [(43, 110, 550, 110), (43, 127, 550, 127),
                                                                      (43, 320, 550, 320)])]), "ocr")
        self.assertNotIn("2||", ms)
        self.assertIn("2 money from tourists", ms["1|a|"]["answer"])

    def test_edexcel_header_with_a_blank_question_heading(self):
        texts = [(150, 122, "Answer"), (290, 122, "Additional guidance"), (450, 122, "Mark"),
                 (48, 160, "1(a)"), (108, 160, "substitution (1)"), (450, 160, "(2)"),
                 (48, 220, "1(b)"), (108, 220, "evaluation"), (450, 220, "(1)")]
        rules = [(x, 110, x, 300) for x in (43, 102, 272, 442, 550)] + \
                [(43, v, 550, v) for v in (110, 130, 190, 300)]
        ms = X.parse_ms(scheme_doc([(texts, rules)]), "edexcel")
        self.assertEqual(ms["1|a|"]["answer"], "substitution (1)")
        self.assertEqual(ms["1|b|"]["answer"], "evaluation")
        # Guidance that names the headings is not one.
        guidance = X.Line(0, [span("2 marks max. if answer", 300)])
        self.assertIsNone(X.headless_header(guidance, [(u, 0, 900) for u in (43, 102, 272, 442, 550)]))

    def test_edexcel_lines_above_a_label_end_the_part_before(self):
        # Pearson tops its labels, so lines above one in the same row (a part
        # carried on, cut from the next by a rule mid-cell) are the part before's.
        texts = [(48, 122, "Question number"), (150, 122, "Answer"), (290, 122, "Notes"), (450, 122, "Marks"),
                 (48, 160, "9 (a) (i)"), (108, 160, "use of a balance;"), (450, 160, "2"),
                 (108, 200, "calculating mean;"), (60, 240, "(ii)"), (108, 240, "C (volume = mass ÷ density);"),
                 (450, 240, "1")]
        rules = [(x, 110, x, 300) for x in (43, 102, 272, 442, 550)] + \
                [(43, v, 550, v) for v in (110, 130, 185, 300)]
        ms = X.parse_ms(scheme_doc([(texts, rules)]), "edexcel")
        self.assertIn("calculating mean;", ms["9|a|i"]["answer"])
        self.assertEqual(ms["9|a|ii"]["answer"], "C (volume = mass ÷ density);")

    def test_edexcel_label_centred_under_its_own_header_starts_its_part(self):
        # A new table: its first row cannot carry the part before over.
        texts = [(48, 122, "Question number"), (150, 122, "Answer"), (450, 122, "Mark"),
                 (48, 150, "9(b)(ii)"), (108, 150, "rate = k[X][Y]"), (450, 150, "(4)"),
                 (48, 212, "Question number"), (150, 212, "Answer"), (450, 212, "Mark"),
                 (108, 240, "The only correct answer is D"), (108, 254, "A is not correct"),
                 (48, 290, "9(c)(i)"), (108, 290, "B is not correct"), (450, 290, "(1)")]
        rules = [(x, 110, x, 180) for x in (43, 102, 442, 550)] + [(x, 200, x, 320) for x in (43, 102, 442, 550)] + \
                [(43, v, 550, v) for v in (110, 130, 180, 200, 220, 320)]
        ms = X.parse_ms(scheme_doc([(texts, rules)]), "edexcel")
        self.assertEqual(ms["9|b|ii"]["answer"], "rate = k[X][Y]")
        self.assertIn("The only correct answer is D", ms["9|c|i"]["answer"])

    def test_edexcel_label_set_a_line_low_starts_its_part(self):
        texts = [(48, 122, "Question number"), (150, 122, "Answer"), (290, 122, "Notes"), (450, 122, "Marks"),
                 (48, 160, "1(a)"), (108, 160, "C6H14 + 9O2"), (450, 160, "2"),
                 (108, 200, "An answer that makes reference to"), (48, 212, "1(b)"), (108, 212, "carbon (1)"),
                 (450, 212, "2")]
        rules = [(x, 110, x, 300) for x in (43, 102, 272, 442, 550)] + \
                [(43, v, 550, v) for v in (110, 130, 185, 300)]
        ms = X.parse_ms(scheme_doc([(texts, rules)]), "edexcel")
        self.assertEqual(ms["1|a|"]["answer"], "C6H14 + 9O2")
        self.assertIn("An answer that makes reference to", ms["1|b|"]["answer"])

    def test_edexcel_label_wrapped_in_its_cell_starts_its_part(self):
        # "2" over "(b)(i)": the line beside the "2" is (b)(i)'s first.
        texts = [(48, 122, "Question number"), (150, 122, "Answer"), (290, 122, "Notes"), (450, 122, "Marks"),
                 (48, 160, "2 (a)"), (108, 160, "D the normal"), (450, 160, "1"),
                 (48, 200, "2"), (108, 200, "Any one from:-"), (450, 200, "1"),
                 (48, 214, "(b)(i)"), (108, 214, "to view distant objects")]
        rules = [(x, 110, x, 300) for x in (43, 102, 272, 442, 550)] + \
                [(43, v, 550, v) for v in (110, 130, 185, 300)]
        ms = X.parse_ms(scheme_doc([(texts, rules)]), "edexcel")
        self.assertEqual(ms["2|a|"]["answer"], "D the normal")
        self.assertIn("Any one from:-", ms["2|b|i"]["answer"])

    def test_headings_split_over_two_rows(self):
        # "Question … Mark" ruled off from "Answer  Notes" below it.
        texts = [(48, 120, "Question"), (450, 120, "Mark"), (150, 130, "Answer"), (290, 130, "Notes"),
                 (48, 160, "9 (a) (i)"), (108, 160, "B (elastic);"), (450, 160, "1"),
                 (108, 200, "MP6. idea of amplitude decreasing")]
        rules = [(x, 110, x, 300) for x in (43, 102, 272, 442, 550)] + \
                [(43, v, 550, v) for v in (110, 124, 140, 185, 300)]
        ms = X.parse_ms(scheme_doc([(texts, rules)]), "edexcel")
        self.assertIn("MP6. idea of amplitude decreasing", ms["9|a|i"]["answer"])

    def test_a_question_heading_wrapped_mid_word(self):
        self.assertIsNotNone(X.header_cells(X.Line(0, [span("Questio", 48), span("Answer", 150),
                                                       span("Mark", 450)])))
        self.assertIsNotNone(X.header_cells(X.Line(0, [span("Qustion", 48), span("Answer", 150),
                                                       span("Mark", 450)])))


class MisprintedKeys(unittest.TestCase):
    def test_a_question_with_no_parts_printed_as_its_a(self):
        self.assertEqual(X.misprinted_key("ocr", {"20|a|": {}, "21|a|": {}}, X.Node(20)), "20|a|")
        self.assertIsNone(X.misprinted_key("ocr", {"20|a|": {}, "20|b|": {}}, X.Node(20)))

    def test_the_letter_printed_where_its_first_numeral_is_due(self):
        scheme = {"8|a|": {}, "8|a|ii": {}, "8|a|iii": {}}
        self.assertEqual(X.misprinted_key("edexcel", scheme, X.Node(8, "a", "i")), "8|a|")
        self.assertIsNone(X.misprinted_key("edexcel", {"8|a|": {}}, X.Node(8, "a", "i")))
        self.assertIsNone(X.misprinted_key("edexcel", scheme, X.Node(8, "a", "iv")))


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

    def test_a_readers_answer_heading_is_not_scheme_text(self):
        pieces = [p for p, _ in C.chunks("Answer: thermal energy (1)\nGuidance: allow heat", scheme=True)]
        self.assertEqual(pieces, ["thermal energy", "allow heat"])

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
