import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { CHECKIN_NOTE_MAX } from "@/lib/platform/textLimits";
import { WeeklyCheckinForm } from "./WeekReviewParts";

// README: notes to the tutor are typed science, so they go through
// SciAnswerBox (its x₂ / x² and Units buttons, and the chips that show how
// "H2O" will read), not a plain textarea.
test("the note to the tutor is a science answer box that keeps its text, limit and hint", () => {
  const html = renderToString(
    <WeeklyCheckinForm
      coveredOk={null}
      busy={null}
      report={() => {}}
      noteState="idle"
      setNoteState={() => {}}
      reflection="Stuck on H2O bonding"
      setReflection={() => {}}
      saveNote={() => {}}
    />,
  );
  expect(html).toContain("data-sci-answer");
  expect(html).toContain('aria-label="Message your tutor about this week"');
  expect(html).toContain(`maxLength="${CHECKIN_NOTE_MAX}"`);
  expect(html).toContain('placeholder="e.g. I got stuck on the meiosis diagram questions');
  expect(html).toContain(">Stuck on H2O bonding</textarea>");
  // The box shows the student how their formula will read.
  expect(html).toContain('class="chip"><span>H<sub');
});
