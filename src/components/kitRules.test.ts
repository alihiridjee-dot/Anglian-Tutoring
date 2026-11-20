import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const SRC = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, SRC), "utf8");

describe("design kit rules", () => {
  // README, "Type": display type is bold (700) or heavier; semibold reads as a
  // different typeface. The base rule gives h1–h6 the display face only, so a
  // heading's weight is still its own class.
  test("no heading is set below bold", () => {
    const light = /<h[1-6]\b[^>]*\bfont-(thin|extralight|light|normal|medium|semibold)\b/g;
    const found = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".tsx"))
      .flatMap((path) => (read(path).match(light) ?? []).map((tag) => `${path}: ${tag}`));
    expect(found).toEqual([]);
  });

  // README, "Everything colours itself from --tint": a raw Tailwind palette
  // class opts an element out of the system, and the site is light-mode only.
  // These are the surfaces the audit's palette sweep has moved onto the kit;
  // the pattern is the one the 18 Nov audit used.
  test("the swept surfaces name no Tailwind palette colour and no dark: token", () => {
    const palette =
      /\b(bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|shadow|divide|accent|caret)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3}|\bdark:[\w[]/g;
    const found = [
      "components/planner/WeekReviewParts.tsx",
      "components/planner/ThisWeekLanes.tsx",
      "components/curriculum/TopicCard.tsx",
      // Zoom's own blue (#2D8CFF) on the live-lesson surfaces is deliberate.
      "components/live/LiveSessionsBanner.tsx",
      "components/live/NextSessionCountdown.tsx",
      "components/live/SessionMeta.tsx",
      "components/live/HeaderLiveButton.tsx",
      "routes/our-story.tsx",
      "components/billing/InvoiceHistory.tsx",
      "components/billing/SwitchBoardDialog.tsx",
    ].flatMap((path) => (read(path).match(palette) ?? []).map((cls) => `${path}: ${cls}`));
    expect(found).toEqual([]);
  });

  // README, "Phones, either way up": a 44px tap target is undone only for a
  // fine pointer. A phone on its side, or a tablet, is wider than `sm`.
  test("the live lesson form keeps its AI draft button 44px on a touch screen", () => {
    expect(read("components/tutor/LiveForm.tsx")).not.toMatch(/\bsm:min-h-0\b/);
  });
});
