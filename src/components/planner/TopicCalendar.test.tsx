import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { PacingBand } from "@/lib/planner/pacing";
import { TopicCalendar } from "./TopicCalendar";

const band = (topicId: string, startWeek: string, endWeek: string, weeks: number): PacingBand => ({
  topicId,
  title: topicId,
  startWeek,
  endWeek,
  weeks,
  kind: "teach",
});

test("a topic with no card in the order shows the break's tile, never a 0", () => {
  // "held" fell in a break's past weeks and carries on first after it; "t1" is card 1.
  const html = renderToString(
    <TopicCalendar
      bands={[
        band("held", "2026-12-14", "2026-12-14", 1),
        band("t1", "2026-12-21", "2027-01-04", 3),
      ]}
      from="2026-12-07"
      examDate="2027-01-11"
      tintOf={() => "tint-sky"}
      numberOf={(id) => (id === "t1" ? 1 : 0)}
      focus={null}
      label="Calendar"
    />,
  );
  expect(html).toContain('aria-label="Carries on after the break"');
  expect(html).toContain(">1</span>");
  expect(html).not.toContain(">0</span>");
});
