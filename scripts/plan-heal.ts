/**
 * The nightly plan check from a terminal: is every week saved for this week in
 * step with its student's full plan? It runs the site's own check
 * (src/lib/planner/planHeal.server.ts), the one pg_cron starts at 02:30 UTC.
 *
 *   bun scripts/plan-heal.ts          # dry run: what it would change, nothing saved
 *   bun scripts/plan-heal.ts --yes    # put the weeks right now
 *
 * The dry run only reads, apart from adding its report to
 * private.plan_heal_runs. `--yes` writes students' real plans, and a re-cut
 * that adds a point with no quiz or task yet queues them for the practice
 * worker, which is paid. Ask Ali before running it.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which Bun reads from .env.
 */
import { checkThisWeek, tally } from "../src/lib/planner/planHeal.server";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

const dryRun = !process.argv.includes("--yes");
const run = await checkThisWeek({ dryRun });

console.log(`Week of ${run.week}${dryRun ? ", dry run: nothing saved" : ""}`);
for (const c of run.courses) {
  const detail = [
    c.reason,
    c.missing ? `${c.missing} missing` : "",
    c.stale ? `${c.stale} now taught later` : "",
    c.error,
  ]
    .filter(Boolean)
    .join(", ");
  console.log(
    `  ${c.studentId.slice(0, 8)}  ${c.subject.padEnd(9)}  ${c.outcome}${detail ? ` (${detail})` : ""}`,
  );
}
console.log(tally(run));
