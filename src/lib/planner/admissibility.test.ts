import { describe, expect, test } from "bun:test";
import {
  admit,
  hasStudentHistory,
  isHandPicked,
  partition,
  spineReach,
  type AdmissionCandidate,
} from "./admissibility";
import { type PacingBand } from "./pacing";

const band = (topicId: string, startWeek: string, endWeek: string, kind?: string): PacingBand => ({
  topicId,
  title: topicId,
  startWeek,
  endWeek,
  weeks: 1,
  ...(kind ? { kind: kind as PacingBand["kind"] } : {}),
});

// Topic 1 is being taught now; topic 3 does not open until November.
const SPINE: PacingBand[] = [
  band("t1", "2026-09-07", "2026-10-05"),
  band("t2", "2026-10-12", "2026-11-02"),
  band("t3", "2026-11-09", "2026-12-07"),
  // A revisit band must never count as the spine reaching a topic.
  band("t3", "2026-09-07", "2026-09-07", "revisit"),
];
const reach = spineReach(SPINE);
const WEEK = "2026-09-07";
const ctx = { reach, weekStart: WEEK, examDate: "2027-05-31" };

const point = (over: Partial<AdmissionCandidate> = {}): AdmissionCandidate => ({
  specPointId: "p1",
  topicId: "t1",
  origin: "core",
  ...over,
});

describe("spineReach", () => {
  test("takes the earliest teach band per topic and ignores revisit bands", () => {
    expect(reach.get("t1")).toBe("2026-09-07");
    expect(reach.get("t3")).toBe("2026-11-09");
  });

  test("treats a legacy band with no kind as the spine", () => {
    expect(spineReach([band("t9", "2026-09-07", "2026-09-14")]).get("t9")).toBe("2026-09-07");
  });
});

describe("admit", () => {
  test("admits a point on a topic the spine has opened", () => {
    expect(admit(point(), ctx).ok).toBe(true);
  });

  // The defect this module exists for: topics 3 and 6 assigned as reviews
  // months before the programme taught them, because a cross-topic quiz had
  // seeded FSRS cards for points the student had never met.
  test("refuses an automatic review on a topic the spine has not reached", () => {
    const v = admit(point({ topicId: "t3", origin: "focus", hasEvidence: true }), ctx);
    expect(v).toEqual({ ok: false, reason: "ahead-of-spine" });
  });

  test("refuses core teaching ahead of the spine too", () => {
    expect(admit(point({ topicId: "t2" }), ctx).reason).toBe("ahead-of-spine");
  });

  test("admits the topic in the week its band opens, not the week after", () => {
    expect(admit(point({ topicId: "t2" }), { ...ctx, weekStart: "2026-10-12" }).ok).toBe(true);
  });

  test("lets a tutor assign ahead of the spine", () => {
    expect(admit(point({ topicId: "t3", origin: "tutor" }), ctx).ok).toBe(true);
    expect(admit(point({ topicId: "t3", origin: "student" }), ctx).ok).toBe(true);
  });

  test("refuses a review with no assessed practice behind it", () => {
    expect(admit(point({ origin: "focus", hasEvidence: false }), ctx).reason).toBe("no-evidence");
  });

  test("does not apply the evidence test to first teaching", () => {
    expect(admit(point({ origin: "core", hasEvidence: false }), ctx).ok).toBe(true);
  });

  test("treats unestablished evidence as unknown, not absent", () => {
    expect(admit(point({ origin: "focus" }), ctx).ok).toBe(true);
  });

  test("refuses another course's topic even to a tutor", () => {
    expect(admit(point({ topicId: "other", origin: "tutor", onCourse: false }), ctx).reason).toBe(
      "off-course",
    );
  });

  // A topic added to the curriculum after the programme was laid is absent from
  // the stored pacing. That is a stale baseline, not a point on another course,
  // and it is what the database trigger allows — the two must agree.
  test("admits a topic the spine map has never heard of", () => {
    expect(admit(point({ topicId: "added-later" }), ctx).ok).toBe(true);
    expect(
      admit(point({ topicId: "added-later", origin: "focus", hasEvidence: true }), ctx).ok,
    ).toBe(true);
  });

  test("refuses a point orphaned by a curriculum re-import", () => {
    expect(admit(point({ topicId: null, origin: "student" }), ctx).reason).toBe("orphaned");
  });

  test("refuses any lane in a week at or past the exam", () => {
    const past = { ...ctx, weekStart: "2027-06-07" };
    expect(admit(point({ origin: "tutor" }), past).reason).toBe("beyond-exam");
    expect(admit(point(), { ...ctx, weekStart: "2027-05-31" }).reason).toBe("beyond-exam");
  });

  test("defaults an unlabelled legacy point to the automatic rule", () => {
    expect(admit({ specPointId: "p", topicId: "t3" }, ctx).reason).toBe("ahead-of-spine");
  });
});

describe("partition", () => {
  test("keeps the caller's objects and reports every refusal by reason", () => {
    const rows = [
      { id: "a", topicId: "t1", origin: "core" as const, onCourse: true },
      { id: "b", topicId: "t3", origin: "focus" as const, onCourse: true },
      { id: "c", topicId: "gone", origin: "ai" as const, onCourse: false },
    ];
    const { admitted, rejected } = partition(
      rows,
      (r) => ({
        specPointId: r.id,
        topicId: r.topicId,
        origin: r.origin,
        hasEvidence: true,
        onCourse: r.onCourse,
      }),
      ctx,
    );
    expect(admitted.map((r) => r.id)).toEqual(["a"]);
    expect(rejected.map((r) => [r.point.id, r.reason])).toEqual([
      ["b", "ahead-of-spine"],
      ["c", "off-course"],
    ]);
  });
});

describe("hasStudentHistory", () => {
  test("is the quarantine line: work the student did, in any of its three forms", () => {
    expect(hasStudentHistory({ done_at: "2026-09-09T10:00:00Z" })).toBe(true);
    expect(hasStudentHistory({ carried_from: "2026-08-31" })).toBe(true);
    expect(hasStudentHistory({ attempted: true })).toBe(true);
    expect(hasStudentHistory({ done_at: null, carried_from: null, attempted: false })).toBe(false);
  });
});

describe("isHandPicked", () => {
  test("is exactly the two human origins", () => {
    expect(["student", "tutor"].every(isHandPicked as never)).toBe(true);
    expect(["ai", "core", "focus", "carried_over"].some(isHandPicked as never)).toBe(false);
  });
});
