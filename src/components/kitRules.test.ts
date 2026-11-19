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

  // README, "Phones, either way up": a 44px tap target is undone only for a
  // fine pointer. A phone on its side, or a tablet, is wider than `sm`.
  test("the live lesson form keeps its AI draft button 44px on a touch screen", () => {
    expect(read("components/tutor/LiveForm.tsx")).not.toMatch(/\bsm:min-h-0\b/);
  });
});
