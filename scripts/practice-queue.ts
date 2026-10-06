/**
 * The practice queue from a terminal: what it holds, and running it by hand.
 *
 * The queue is the one writer of every spec point's shared quiz and task, and
 * the site's worker runs it every minute on its own. This is the only
 * sanctioned way to run generation by hand, and it runs the worker's own code.
 *
 *   bun scripts/practice-queue.ts                           # status, the default
 *   bun scripts/practice-queue.ts run                       # dry run: what one call would write
 *   bun scripts/practice-queue.ts run --max-calls 3         # dry run for up to three
 *   bun scripts/practice-queue.ts run --max-calls 3 --yes   # run them: PAID
 *   bun scripts/practice-queue.ts retry-failed              # put every failed job back
 *   bun scripts/practice-queue.ts retry-failed --point <spec point uuid>
 *   bun scripts/practice-queue.ts pause --minutes 60 --reason "checking a bad quiz"
 *   bun scripts/practice-queue.ts resume
 *
 * `run` touches nothing without `--yes`: it lists the ready jobs it would take
 * and roughly what they would cost. Each job is one model call, about $0.06.
 * `--max-calls` is 1 unless given and 10 at most, and the queue's own limits
 * (a pause, calls in flight, calls per 24 hours) still apply. `retry-failed`
 * spends too, a minute later: the worker takes the jobs it puts back.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which Bun reads from .env;
 * `run --yes` also needs ANTHROPIC_API_KEY.
 */
import { libraryRequest } from "../src/lib/homework/examGeneration.server";
import { drainPracticeQueue, type JobOutcome } from "../src/lib/practice/practiceQueue.server";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

/** Roughly what one call costs: an 8-question quiz or a 5-question task. */
const COST_PER_CALL = 0.06;
const MAX_CALLS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const [command = "status", ...args] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

type Job = {
  job_id: number;
  spec_point_id: string;
  code: string;
  title: string;
  kind: string;
  attempts: number;
};

type QueueStatus = {
  paused_until: string | null;
  pause_reason: string | null;
  daily_call_limit: number;
  calls_24h: number;
  in_flight: number;
  max_in_flight: number;
  max_attempts: number;
  counts: { pending: number; generating: number; completed: number; failed: number };
  ready: Job[];
  failed: (Job & { last_error: string | null; updated_at: string })[];
};

const queueStatus = async () =>
  (await libraryRequest("rpc/practice_queue_status", {})) as QueueStatus;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB");
const isPaused = (s: QueueStatus) => !!s.paused_until && Date.parse(s.paused_until) > Date.now();
const describeJob = (j: Job) =>
  `#${j.job_id} ${j.kind} ${j.code} ${j.title} (attempts so far: ${j.attempts})`;

/** How many jobs a claim would hand out now: the sums `claim_practice_jobs` does. */
function claimable(s: QueueStatus, wanted: number): number {
  if (isPaused(s)) return 0;
  const inFlightRoom = s.max_in_flight - s.in_flight;
  const dailyRoom = s.daily_call_limit - s.calls_24h - s.in_flight;
  return Math.max(0, Math.min(wanted, inFlightRoom, dailyRoom));
}

function describeOutcome(o: JobOutcome): string {
  const job = `#${o.job_id} ${o.kind} for spec point ${o.spec_point_id}`;
  switch (o.result) {
    case "written":
      return `${job}: written (${o.result_id})`;
    case "already_existed":
      return `${job}: the point already had one (${o.result_id}); this call's questions were not kept`;
    case "lost_claim":
      return `${job}: another worker took the job over; nothing saved`;
    case "failed":
      return `${job}: failed (${o.failure}): ${o.error}. The job is now ${o.status_after}`;
  }
}

async function status() {
  const s = await queueStatus();
  console.log(
    isPaused(s)
      ? `Paused until ${when(s.paused_until!)}${s.pause_reason ? `: ${s.pause_reason}` : ""}`
      : "Running",
  );
  console.log(`Model calls in the last 24 hours: ${s.calls_24h} of ${s.daily_call_limit}`);
  console.log(`Writing now: ${s.in_flight} of ${s.max_in_flight}`);
  const c = s.counts;
  console.log(
    `Jobs: ${c.pending} pending, ${c.generating} writing, ${c.completed} done, ${c.failed} failed`,
  );
  if (s.ready.length)
    console.log(`\nReady:\n${s.ready.map((j) => `  ${describeJob(j)}`).join("\n")}`);
  if (s.failed.length)
    console.log(
      `\nFailed:\n${s.failed
        .map((j) => `  ${describeJob(j)}, ${when(j.updated_at)}\n    ${j.last_error ?? ""}`)
        .join("\n")}`,
    );
}

async function run() {
  const maxCalls = Number(args.includes("--max-calls") ? flag("max-calls") : "1");
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > MAX_CALLS)
    fail(`--max-calls takes a whole number from 1 to ${MAX_CALLS}`);

  if (!args.includes("--yes")) {
    const s = await queueStatus();
    const take = s.ready.slice(0, claimable(s, maxCalls));
    if (isPaused(s))
      console.log(`The queue is paused until ${when(s.paused_until!)}: nothing would run.`);
    else if (take.length === 0)
      console.log("Nothing would run: no job is ready, or the queue is at its limits.");
    else {
      const cost = (take.length * COST_PER_CALL).toFixed(2);
      console.log(`Would write at most ${take.length}, about $${cost}:`);
      for (const j of take) console.log(`  ${describeJob(j)}`);
      if (take.length < Math.min(maxCalls, s.ready.length))
        console.log(
          `Fewer than asked: the queue's limits on calls in flight and per 24 hours leave room for ${take.length}.`,
        );
    }
    console.log("\nDry run: nothing was claimed or paid for. Add --yes to run it.");
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) fail("run --yes needs ANTHROPIC_API_KEY");
  const outcomes = await drainPracticeQueue({ maxJobs: maxCalls });
  if (outcomes.length === 0)
    console.log("The queue handed out nothing: paused, at its limits, or nothing ready.");
  for (const o of outcomes) console.log(describeOutcome(o));
  if (outcomes.some((o) => o.result === "failed")) process.exitCode = 1;
}

async function retryFailed() {
  const point = flag("point");
  if (args.includes("--point") && !UUID.test(point ?? ""))
    fail("--point takes a spec point's uuid");
  const count = await libraryRequest("rpc/rearm_failed_practice_jobs", {
    _spec_point_ids: point ? [point] : null,
  });
  console.log(
    `Put ${count} failed job(s) back in the queue. The worker takes them within a minute: ` +
      `each is one paid call, about $${COST_PER_CALL.toFixed(2)}.`,
  );
}

async function pause() {
  const minutes = Number(flag("minutes"));
  if (!Number.isInteger(minutes) || minutes < 1)
    fail("pause takes --minutes M, a whole number of at least 1");
  const until = (await libraryRequest("rpc/pause_practice_queue", {
    _minutes: minutes,
    _reason: flag("reason") ?? null,
  })) as string;
  console.log(`Paused until ${when(until)}.`);
}

async function resume() {
  await libraryRequest("rpc/pause_practice_queue", { _minutes: 0, _reason: null });
  console.log("Resumed: the worker takes ready jobs within a minute.");
}

const commands: Record<string, () => Promise<void>> = {
  status,
  run,
  "retry-failed": retryFailed,
  pause,
  resume,
};
const chosen = commands[command];
if (!chosen) fail(`Unknown command "${command}": use status, run, retry-failed, pause or resume`);
await chosen();
