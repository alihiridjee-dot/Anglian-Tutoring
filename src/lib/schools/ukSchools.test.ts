import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldSchoolText, indexSchools, MAX_SUGGESTIONS, searchSchools } from "./ukSchools";

const file = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../public/uk-schools.json"), "utf8"),
) as { schools: Array<[string, string]> };
const schools = indexSchools(file.schools.map(([name, place]) => ({ name, place })));
const names = (query: string) => searchSchools(schools, query).map((s) => s.name);

describe("foldSchoolText", () => {
  test("drops apostrophes, accents and case, and reads saint as st", () => {
    expect(foldSchoolText("St Mary’s")).toBe("st marys");
    expect(foldSchoolText("Saint Mary's")).toBe("st marys");
    expect(foldSchoolText("Ysgol Gŵyr")).toBe("ysgol gwyr");
    expect(foldSchoolText("  Notre-Dame & St. Paul ")).toBe("notre dame and st paul");
  });
});

describe("the school list", () => {
  test("covers all four nations and no primaries", () => {
    const all = file.schools.map(([name]) => name);
    expect(all.length).toBeGreaterThan(7000);
    for (const name of [
      "Hills Road Sixth Form College", // England, FE
      "Ysgol Gyfun Gymraeg Glantaf", // Wales
      "Jordanhill School", // Scotland, grant-aided
      "George Watson's College", // Scotland, independent
      "Methodist College", // Northern Ireland
    ]) {
      expect(all).toContain(name);
    }
    expect(all.filter((n) => /\bprimary school$/i.test(n)).length).toBeLessThan(5);
  });
});

describe("searchSchools", () => {
  test("waits for two characters", () => {
    expect(searchSchools(schools, "n")).toEqual([]);
    expect(searchSchools(schools, "  ")).toEqual([]);
  });

  test("puts the school whose name starts with the query first", () => {
    expect(names("norwich school")[0]).toBe("Norwich School");
    expect(names("hills road")[0]).toBe("Hills Road Sixth Form College");
  });

  test("forgives a missing apostrophe and matches words in any order", () => {
    expect(names("st marys").every((n) => /^St Mary.s/.test(n))).toBe(true);
    expect(names("watsons george")).toContain("George Watson's College");
  });

  test("lets the town pick between schools with the same name", () => {
    const hits = searchSchools(schools, "notre dame norwich");
    expect(hits[0]).toEqual({ name: "Notre Dame High School, Norwich", place: "Norwich" });
  });

  test("never offers more than the cap", () => {
    expect(searchSchools(schools, "school").length).toBe(MAX_SUGGESTIONS);
  });

  test("offers nothing for a school that isn't listed", () => {
    expect(searchSchools(schools, "zzqx academy")).toEqual([]);
  });
});
