import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { PlanPoint } from "@/lib/planner/weeklyPlanDal";
import type { PointCoverage, PointWorkItem } from "@/lib/planner/coverage";
import type { Activity } from "./useWeekPlan";
import { DoNowPanel } from "./DoNowPanel";

/**
 * On a phone held upright the weekly task list draws each row as a step trail;
 * everywhere else it draws the four cells. The browser picks between them off
 * one variant, so what can be pinned here is the contract that makes that
 * safe: the two halves hide on exactly opposite conditions, the condition is a
 * phone's and not a tablet's or a narrow desktop window's, and whichever half
 * a screen gets opens exactly the same things.
 */

const point = (id: string, code: string, doneAt: string | null = null): PlanPoint => ({
  spec_point_id: id,
  code,
  title: `Point ${code}`,
  description: null,
  topic_id: "t1",
  topic_title: null,
  origin: "core",
  carried_from: null,
  done_at: doneAt,
});

const item = (id: string): PointWorkItem => ({ id, title: `Item ${id}`, videoUrl: null });

const coverage = (c: Partial<PointCoverage>): PointCoverage => ({
  attempted: true,
  homeworkDone: false,
  quizDone: false,
  bestScore: null,
  homeworkScore: null,
  quizScore: null,
  ...c,
});

// A week with every shape a row can take: all done and marked, two quizzes and
// a task handed in but not marked, a video and a note only, and nothing at all.
const POINTS = [
  point("p1", "0.3", "2026-10-27T10:00:00Z"),
  point("p2", "0.4"),
  point("p3", "1.42"),
  point("p4", "1.43"),
];

const ACTIVITY: Activity = new Map([
  [
    "p1",
    {
      hasHomework: true,
      hasQuiz: true,
      videos: [item("v1")],
      quizzes: [item("q1")],
      homework: [item("h1")],
    },
  ],
  [
    "p2",
    {
      hasHomework: true,
      hasQuiz: true,
      videos: [item("v2")],
      quizzes: [item("q2a"), item("q2b")],
      homework: [item("h2")],
    },
  ],
  ["p3", { hasHomework: false, hasQuiz: false, videos: [item("v3")], quizzes: [], homework: [] }],
  ["p4", { hasHomework: false, hasQuiz: false, videos: [], quizzes: [], homework: [] }],
]);

const COVERAGE = new Map([
  ["p1", coverage({ quizDone: true, homeworkDone: true, quizScore: 13, homeworkScore: 0 })],
  ["p2", coverage({ homeworkDone: true })],
]);

const NOTES = new Map([
  ["p1", [{ id: "n1", title: "Note 1" }]],
  ["p2", [{ id: "n2", title: "Note 2" }]],
  ["p3", [{ id: "n3", title: "Note 3" }]],
]);

async function renderPanel(): Promise<string> {
  const root = createRootRoute({
    component: () => (
      <DoNowPanel
        points={POINTS}
        activity={ACTIVITY}
        coverage={COVERAGE}
        subject="chemistry"
        editable
        onToggle={() => {}}
      />
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const queries = new QueryClient();
  queries.setQueryData(["spec-point-notes", ["p1", "p2", "p3", "p4"]], NOTES);
  return renderToString(
    <QueryClientProvider client={queries}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** Each row, split into its trail and the cells after it. */
async function rows() {
  const html = await renderPanel();
  return html
    .split("<li")
    .slice(1)
    .map((li) => {
      // The trail holds no <div> of its own, so it ends at the first </div>.
      const trail = li.match(/<div class="([^"]*phone:flex[^"]*)">(.*?)<\/div>/);
      if (!trail) throw new Error("a row has no step trail");
      const rest = li.slice(li.indexOf(trail[0]) + trail[0].length);
      return { trailClass: trail[1], trail: trail[2], cells: rest };
    });
}

const all = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]).sort();
const hrefs = (html: string) => all(html, /href="([^"]+)"/g);
const videos = (html: string) => all(html, /<button type="button" title="([^"]+)"/g);
const gaps = (html: string) => all(html, /<span class="sr-only">(No [^<]+)<\/span>/g);

describe("the weekly task list's step trail is a phone's and nobody else's", () => {
  test("the trail and the cells hide on exactly opposite conditions", async () => {
    for (const row of await rows()) {
      // Hidden unless the screen is a phone…
      expect(row.trailClass.split(" ")).toEqual(expect.arrayContaining(["hidden", "phone:flex"]));
      // …and every cell hidden when it is, all four of them.
      const cells = all(row.cells, /<div class="(flex flex-wrap[^"]*)"/g);
      expect(cells).toHaveLength(4);
      for (const c of cells) expect(c.split(" ")).toContain("phone:hidden");
    }
  });

  test("a phone is narrower than any tablet and driven by a finger", () => {
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const phone = css.match(/@custom-variant phone \((.+)\);/);
    expect(phone?.[1]).toBe("@media (width < 37.5rem) and (pointer: coarse)");
  });

  test("whichever half a screen gets opens exactly the same things", async () => {
    for (const row of await rows()) {
      expect(hrefs(row.trail)).toEqual(hrefs(row.cells));
      expect(videos(row.trail)).toEqual(videos(row.cells));
    }
  });

  test("one step per item, so a point with two quizzes keeps both", async () => {
    const [, two] = await rows();
    expect(hrefs(two.trail).filter((h) => h.startsWith("/mcq/"))).toEqual(["/mcq/q2a", "/mcq/q2b"]);
  });

  test("a gap says the same thing in both halves", async () => {
    const [, , videoAndNote, nothing] = await rows();
    expect(gaps(videoAndNote.trail)).toEqual([
      "No quiz on this point yet",
      "No tasks set on this point yet",
    ]);
    expect(gaps(videoAndNote.trail)).toEqual(gaps(videoAndNote.cells));
    expect(gaps(nothing.trail)).toHaveLength(4);
    expect(gaps(nothing.trail)).toEqual(gaps(nothing.cells));
  });

  test("done work reads as done, with its mark when there is one", async () => {
    const [marked, handedIn] = await rows();
    expect(marked.trail).toContain('<span class="sr-only">Quiz </span>13%');
    expect(marked.trail).toContain('<span class="sr-only">Task </span>0%');
    // Handed in, not marked yet: done, not a fresh "Task" to start again.
    expect(handedIn.trail).toContain('<span class="sr-only">Task </span>Handed in');
    // The quizzes aren't done, so they still say so.
    expect(handedIn.trail.match(/>Quiz</g)).toHaveLength(2);
  });
});
