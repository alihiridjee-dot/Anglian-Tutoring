/**
 * Sweep every saved weekly plan for assignments that should never have been
 * made, using the same rule the application enforces
 * (`src/lib/planner/admissibility.ts`).
 *
 * This exists because the first batch of these was found by a person noticing
 * that two topics were being revised before they had been taught. That is not a
 * detection strategy. Run this after any planner change, after applying a
 * migration, and on a schedule if you like — it answers the question a human
 * had to ask by hand.
 *
 *   bun run scripts/audit-plan-integrity.ts           # report
 *   bun run scripts/audit-plan-integrity.ts --json    # machine-readable
 *
 * Read-only. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, because it reads
 * across all students and every relevant table is behind RLS.
 *
 * Exits non-zero when anything is found, so it can gate a deploy.
 */
import {
  admit,
  describeReason,
  hasStudentHistory,
  spineReach,
  type PointOrigin,
  type RejectionReason,
} from "../src/lib/planner/admissibility";
import { assessmentPointScores } from "../src/lib/scheduleDal";
import { sourcesFromRows } from "../src/lib/planner/attemptSources";
import type { CourseSnapshot } from "../src/lib/planner/readModels";
import { practiceInWeek } from "../src/lib/planner/coverage";
import { type PacingBand } from "../src/lib/planner/pacing";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
const asJson = process.argv.includes("--json");

/** PostgREST caps a response at 1000 rows; page until it stops filling. */
async function all<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  const size = 1000;
  for (let from = 0; ;) {
    const res = await fetch(`${url}/rest/v1/${path}&offset=${from}&limit=${size}`, {
      headers: {
        apikey: key!,
        ...(key!.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
        Range: `${from}-${from + size - 1}`,
      },
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as T[];
    rows.push(...page);
    if (!page.length) return rows;
    from += page.length;
  }
}

type Programme = { student_id: string; subject: string; pacing: PacingBand[]; exam_date: string };
type Plan = {
  id: string;
  student_id: string;
  subject: string;
  board: string;
  level: string;
  week_start: string;
};
type Point = {
  plan_id: string;
  spec_point_id: string;
  origin: PointOrigin;
  done_at: string | null;
  carried_from: string | null;
};
type SpecPoint = { id: string; code: string; title: string; topic_id: string | null };
type Topic = { id: string; title: string; subject: string; board: string; level: string };
type Enrolment = { student_id: string; subject: string; board: string };
type Profile = { id: string; level: string | null };

const [programmes, plans, points, specPoints, topics, enrolments, profiles] = await Promise.all([
  all<Programme>(
    "student_program_plan?select=student_id,subject,pacing,exam_date&order=student_id,subject",
  ),
  all<Plan>("student_weekly_plans?select=id,student_id,subject,board,level,week_start&order=id"),
  all<Point>(
    "student_weekly_plan_points?select=plan_id,spec_point_id,origin,done_at,carried_from&order=plan_id,spec_point_id",
  ),
  all<SpecPoint>("spec_points?select=id,code,title,topic_id&order=id"),
  all<Topic>("topics?select=id,title,subject,board,level&order=id"),
  all<Enrolment>("student_enrolments?select=student_id,subject,board&order=student_id,subject"),
  all<Profile>("profiles?select=id,level&order=id"),
]);

const programmeOf = new Map(programmes.map((p) => [`${p.student_id}|${p.subject}`, p]));
const planOf = new Map(plans.map((p) => [p.id, p]));
const pointOf = new Map(specPoints.map((p) => [p.id, p]));
const topicOf = new Map(topics.map((t) => [t.id, t]));
const reachCache = new Map<string, Map<string, string>>();

type Finding = {
  student: string;
  subject: string;
  week: string;
  code: string;
  title: string;
  topic: string;
  origin: PointOrigin;
  reason: RejectionReason;
  /** Carries the student's own work, so it is quarantined rather than removed. */
  quarantined: boolean;
};

/**
 * Plans for a course the student does not sit.
 *
 * A separate question from per-point admissibility, and invisible to it: the
 * point rule compares a topic to the *plan's* board, so a wholly wrong plan
 * holding wholly matching points agrees with itself and passes. One Edexcel
 * chemistry student had a week built from the AQA tree exactly this way.
 * Skipped where there is nothing to compare against, matching the trigger.
 */
const enrolledOn = new Set(enrolments.map((e) => `${e.student_id}|${e.subject}|${e.board}`));
const hasEnrolment = new Set(enrolments.map((e) => `${e.student_id}|${e.subject}`));
const levelOf = new Map(profiles.map((p) => [p.id, p.level]));

const wrongCourse = plans.filter((plan) => {
  if (
    hasEnrolment.has(`${plan.student_id}|${plan.subject}`) &&
    !enrolledOn.has(`${plan.student_id}|${plan.subject}|${plan.board}`)
  )
    return true;
  const level = levelOf.get(plan.student_id);
  return !!level && level !== plan.level;
});

// Use the same source snapshot and attribution as the application, with no
// per-table REST cap on assessment history. Missing RPCs fail the audit closed.
const snapshots = new Map<string, CourseSnapshot>();
const weekEvidence = new Map<string, { assessed: Set<string>; attempted: Set<string> }>();
async function evidenceFor(plan: Plan) {
  const courseKey = `${plan.student_id}|${plan.subject}|${plan.board}|${plan.level}`;
  const weekKey = `${courseKey}|${plan.week_start}`;
  const cached = weekEvidence.get(weekKey);
  if (cached) return cached;
  let snapshot = snapshots.get(courseKey);
  if (!snapshot) {
    const res = await fetch(`${url}/rest/v1/rpc/planner_course_snapshot`, {
      method: "POST",
      headers: {
        apikey: key!,
        "Content-Type": "application/json",
        ...(key!.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify({
        _student: plan.student_id,
        _subject: plan.subject,
        _board: plan.board,
        _level: plan.level,
      }),
    });
    if (!res.ok) throw new Error(`Assessment snapshot: ${res.status} ${await res.text()}`);
    snapshot = (await res.json()) as CourseSnapshot;
    snapshots.set(courseKey, snapshot);
  }
  const sources = sourcesFromRows(snapshot.sources);
  const assessed = new Set<string>();
  const attempted = new Set<string>();
  for (const sub of snapshot.submissions) {
    for (const id of sources.resourceToPoints.get(sub.resource_id) ?? []) {
      if (practiceInWeek(sub.submitted_at, plan.week_start)) attempted.add(id);
      if (
        sub.score_pct != null &&
        Number.isFinite(Number(sub.score_pct)) &&
        Number.isFinite(new Date(sub.graded_at ?? sub.submitted_at).getTime())
      )
        assessed.add(id);
    }
  }
  for (const attempt of snapshot.attempts) {
    const scores = assessmentPointScores(
      attempt.point_scores,
      sources.setScope.get(attempt.set_id) ?? new Set(),
      attempt.score,
      attempt.total,
    );
    if (Number.isFinite(new Date(attempt.created_at).getTime()))
      for (const [id, score] of scores) if (Number.isFinite(score)) assessed.add(id);
    if (practiceInWeek(attempt.created_at, plan.week_start))
      for (const id of new Set([
        ...(sources.setToPoints.get(attempt.set_id) ?? []),
        ...scores.keys(),
      ]))
        attempted.add(id);
  }
  const result = { assessed, attempted };
  weekEvidence.set(weekKey, result);
  return result;
}

const findings: Finding[] = [];
for (const row of points) {
  const plan = planOf.get(row.plan_id);
  if (!plan) continue;
  const key = `${plan.student_id}|${plan.subject}`;
  const programme = programmeOf.get(key);

  let reach = reachCache.get(key);
  if (!reach) {
    reach = spineReach(programme?.pacing ?? []);
    reachCache.set(key, reach);
  }

  const evidence = await evidenceFor(plan);
  const point = pointOf.get(row.spec_point_id);
  // The script can answer "on course" properly — it holds every topic's own
  // subject/board/level — so it does, rather than inferring it from the spine
  // map, which cannot tell another board's topic from a stale baseline.
  const topic = point?.topic_id ? topicOf.get(point.topic_id) : undefined;
  const verdict = admit(
    {
      specPointId: row.spec_point_id,
      topicId: topic ? point!.topic_id : null,
      hasEvidence: evidence.assessed.has(row.spec_point_id),
      origin: row.origin,
      onCourse: topic
        ? topic.subject === plan.subject && topic.board === plan.board && topic.level === plan.level
        : undefined,
    },
    { reach, weekStart: plan.week_start, examDate: programme?.exam_date },
  );
  if (verdict.ok) continue;

  findings.push({
    student: plan.student_id,
    subject: plan.subject,
    week: plan.week_start,
    code: point?.code ?? row.spec_point_id,
    title: point?.title ?? "(missing spec point)",
    topic: (point?.topic_id && topicOf.get(point.topic_id)?.title) || "(no topic)",
    origin: row.origin,
    reason: verdict.reason!,
    quarantined: hasStudentHistory({
      ...row,
      attempted: evidence.attempted.has(row.spec_point_id),
    }),
  });
}

if (asJson) {
  console.log(JSON.stringify({ scanned: points.length, wrongCourse, findings }, null, 2));
} else {
  console.log(`Scanned ${points.length} plan points across ${plans.length} weeks.\n`);
  if (wrongCourse.length > 0) {
    console.log(
      `plan-off-course — the student is not enrolled on this course (${wrongCourse.length})`,
    );
    for (const p of wrongCourse)
      console.log(
        `  ${p.week_start}  ${p.subject.padEnd(10)} plan says ${p.board}/${p.level}  student ${p.student_id}`,
      );
    console.log("");
  }
  if (findings.length === 0) {
    console.log(
      wrongCourse.length === 0
        ? "No inadmissible assignments."
        : "No inadmissible points, but see the plan-off-course weeks above.",
    );
  } else {
    const byReason = new Map<RejectionReason, Finding[]>();
    for (const f of findings) byReason.set(f.reason, [...(byReason.get(f.reason) ?? []), f]);
    for (const [reason, rows] of byReason) {
      console.log(`${reason} — ${describeReason(reason)} (${rows.length})`);
      for (const f of rows)
        console.log(
          `  ${f.week}  ${f.subject.padEnd(10)} ${f.code.padEnd(10)} ${f.origin.padEnd(12)} ` +
            `${f.quarantined ? "quarantined" : "removable "}  ${f.topic} — ${f.title}`,
        );
      console.log("");
    }
    console.log(
      `${findings.length} inadmissible assignment(s). ` +
        `"removable" ones clear on the next re-cut; "quarantined" ones are withheld ` +
        `from the week but kept, because the student has work recorded against them.`,
    );
  }
}

process.exit(findings.length > 0 || wrongCourse.length > 0 ? 1 : 0);
