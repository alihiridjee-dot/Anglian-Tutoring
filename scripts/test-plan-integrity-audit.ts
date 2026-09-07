/** Exercise the real read-only audit with a capped, deterministic REST fixture. */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
const dir = mkdtempSync(join(tmpdir(), "plan-audit-test-"));
try {
  const fixture = join(dir, "fetch.ts");
  writeFileSync(
    fixture,
    `
const tables = {
 student_program_plan: [],
 student_weekly_plans: [
  {id:'p1',student_id:'s',subject:'biology',board:'aqa',level:'gcse',week_start:'2026-09-07'},
  {id:'p2',student_id:'s',subject:'chemistry',board:'aqa',level:'igcse',week_start:'2026-09-07'}],
 student_weekly_plan_points: [
  {plan_id:'p1',spec_point_id:'off',origin:'tutor',done_at:null,carried_from:null},
  {plan_id:'p1',spec_point_id:'review',origin:'focus',done_at:null,carried_from:null},
  {plan_id:'p1',spec_point_id:'valid',origin:'core',done_at:null,carried_from:null}],
 spec_points: [
  {id:'off',code:'C1',title:'Wrong course',topic_id:'chem'},
  {id:'review',code:'B1',title:'Ungraded practice',topic_id:'bio'},
  {id:'valid',code:'B2',title:'Teaching',topic_id:'bio'}],
 topics: [{id:'bio',title:'Biology',subject:'biology',board:'aqa',level:'gcse'},
  {id:'chem',title:'Chemistry',subject:'chemistry',board:'aqa',level:'gcse'}],
 student_enrolments: [], profiles: [{id:'s',level:'gcse'}],
};
globalThis.fetch = async (input, init) => {
 const url = new URL(String(input));
 if (url.hostname !== 'audit.invalid') throw new Error('Unexpected host');
 if (new Headers(init?.headers).has('Authorization')) throw new Error('Opaque key must not be a bearer token');
 const table = url.pathname.split('/').at(-1);
 if (table === 'planner_course_snapshot') return Response.json({topics:[],points:[],
  sources:{resourceLinks:[{resource_id:'hw',spec_point_id:'review'}],setLinks:[],setScope:[]},
  submissions:[{id:'h',resource_id:'hw',score_pct:null,graded_at:null,submitted_at:'2026-09-08'}],attempts:[]});
 if (!(table in tables) || !url.searchParams.has('order')) throw new Error('Missing deterministic pagination');
 const offset = Number(url.searchParams.get('offset'));
 return Response.json(tables[table].slice(offset, offset + 1));
};
`,
  );
  const proc = Bun.spawn(
    [process.execPath, "--preload", fixture, "scripts/audit-plan-integrity.ts", "--json"],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        SUPABASE_URL: "https://audit.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  assert.equal(exit, 1, stderr);
  const result = JSON.parse(stdout);
  assert.equal(
    result.scanned,
    3,
    "server caps smaller than requested pages do not truncate the audit",
  );
  assert.deepEqual(
    result.wrongCourse.map((p: { id: string }) => p.id),
    ["p2"],
    "profile level without enrolment",
  );
  assert.deepEqual(
    result.findings.map((f: { reason: string }) => f.reason).sort(),
    ["no-evidence", "off-course"],
    "missing baseline never bypasses independent checks",
  );
  assert.equal(
    result.findings.find((f: { reason: string }) => f.reason === "no-evidence").quarantined,
    true,
    "ungraded attempts are preserved history",
  );
  console.log(
    "Audit regression passed: small REST caps, no baseline, wrong course/level, no evidence, attempted history and opaque API keys.",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
