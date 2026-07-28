import { describe, expect, test } from "bun:test";
import { resolvePackagesForLevel, type PackageRow } from "./billing";

const pkg = (tier: string, level: string | null, price = 1999): PackageRow => ({
  id: `${tier}:${level ?? "all"}`,
  tier,
  name: `${tier}${level ? ` · ${level}` : ""}`,
  description: null,
  price_pence: price,
  billing_interval: "week",
  level,
});

/** The standard ladder, plus an iGCSE override for every tier. */
const LADDER: PackageRow[] = [
  pkg("weekly_1", null, 1999),
  pkg("weekly_1", "igcse", 1999),
  pkg("weekly_2", null, 2239),
  pkg("weekly_2", "igcse", 2239),
  pkg("weekly_3", null, 2399),
  pkg("weekly_3", "igcse", 2399),
];

describe("resolvePackagesForLevel", () => {
  test("a student with no level sees only the general ladder", () => {
    const out = resolvePackagesForLevel(LADDER, null);
    expect(out.map((p) => p.tier)).toEqual(["weekly_1", "weekly_2", "weekly_3"]);
    expect(out.every((p) => p.level === null)).toBe(true);
  });

  test("a level with no overrides falls back to the general ladder", () => {
    const out = resolvePackagesForLevel(LADDER, "gcse");
    expect(out.map((p) => p.tier)).toEqual(["weekly_1", "weekly_2", "weekly_3"]);
    expect(out.every((p) => p.level === null)).toBe(true);
  });

  test("an iGCSE student sees the override instead of the general row, never both", () => {
    const out = resolvePackagesForLevel(LADDER, "igcse");
    expect(out.map((p) => p.tier)).toEqual(["weekly_1", "weekly_2", "weekly_3"]);
    expect(out.every((p) => p.level === "igcse")).toBe(true);
    // The regression that matters: one tier must never yield two cards.
    expect(out).toHaveLength(3);
  });

  test("overrides apply per tier, so a partial override list still fills the gaps", () => {
    const partial: PackageRow[] = [
      pkg("weekly_1", null),
      pkg("weekly_1", "igcse"),
      pkg("weekly_2", null),
    ];
    const out = resolvePackagesForLevel(partial, "igcse");
    expect(out.map((p) => [p.tier, p.level])).toEqual([
      ["weekly_1", "igcse"],
      ["weekly_2", null],
    ]);
  });

  test("display order is preserved", () => {
    const out = resolvePackagesForLevel(LADDER, "igcse");
    expect(out.map((p) => p.price_pence)).toEqual([1999, 2239, 2399]);
  });

  test("a level whose rows are the only ones present is still offered", () => {
    const onlyOverride = [pkg("weekly_1", "igcse")];
    expect(resolvePackagesForLevel(onlyOverride, "igcse")).toHaveLength(1);
    // ...and is not leaked to anyone else.
    expect(resolvePackagesForLevel(onlyOverride, "gcse")).toHaveLength(0);
    expect(resolvePackagesForLevel(onlyOverride, null)).toHaveLength(0);
  });
});
