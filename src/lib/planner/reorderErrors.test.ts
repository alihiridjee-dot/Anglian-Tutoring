import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { plainReorderError } from "./reorderErrors";

const MIGRATIONS = join(import.meta.dir, "../../../supabase/migrations");

/** Every refusal in the latest definition of a database function, `%` filled in. */
function refusalsOf(fn: string): string[] {
  const file = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => readFileSync(join(MIGRATIONS, f), "utf8").includes(`function ${fn}(`))!;
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(`function ${fn}(`);
  // The body is quoted with whatever tag it opens with: $function$, or $$.
  const open = /\bas (\$[a-z_]*\$)/i.exec(sql.slice(start))!;
  const from = start + open.index + open[0].length;
  const body = sql.slice(from, sql.indexOf(open[1], from));
  return [...body.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) =>
    m[1].replaceAll("''", "'").replaceAll("%", "x"),
  );
}

/** Already in words a student can act on. */
const PLAIN_AS_WRITTEN = new Set([
  "Sign in to change topic order.",
  "Only the student or their tutor can change their topic order.",
  "Open the planner before changing topic order.",
]);

describe("plainReorderError", () => {
  test("a stale page is told to reload, in the button's own word", () => {
    expect(
      plainReorderError("The plan changed in another window. Reload and preview the order again."),
    ).toBe("The plan has changed since this page opened. Reload, then save the order again.");
    expect(plainReorderError("Invalid calendar allocation.")).toContain("Reload");
  });

  test("a refusal it doesn't know is shown as the database wrote it", () => {
    const own = "This is a break week, so nothing new can be planned for it.";
    expect(plainReorderError(own)).toBe(own);
    expect(plainReorderError("TypeError: Failed to fetch")).toBe("TypeError: Failed to fetch");
  });

  for (const fn of ["public.reorder_student_topics", "public.enforce_plan_point_admissible"])
    test(`every refusal ${fn} can raise reads in plain words`, () => {
      const refusals = refusalsOf(fn);
      expect(refusals.length).toBeGreaterThan(0);
      for (const raw of refusals) {
        const shown = plainReorderError(raw);
        if (PLAIN_AS_WRITTEN.has(raw)) expect(shown).toBe(raw);
        else expect(shown).toEndWith("Reload, then save the order again.");
      }
    });
});
