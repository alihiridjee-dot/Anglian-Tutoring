import { describe, expect, test } from "bun:test";
import { gradeFromPct, summariseAnalytics } from "@/lib/profile/analytics";
import { DAY_MS, LIVE_TAIL_MS } from "@/lib/live/liveSessions";
import {
  DEMO_ANALYTICS,
  DEMO_ANSWERS,
  DEMO_CURRICULUM_CONTENT,
  DEMO_HOMEWORK,
  DEMO_LIVE,
  DEMO_MCQ,
  DEMO_MCQ_ATTEMPTS,
  DEMO_MCQ_SETS,
  DEMO_MCQ_SETS_LATER,
  DEMO_QUESTIONS,
  DEMO_SCORED_WORK,
  DEMO_SUBJECTS,
  DEMO_SUBMISSIONS,
} from "./studentDemo";

describe("the showcase's marked tasks", () => {
  test("every score is the marks awarded over the marks available, and its grade", () => {
    const marked = Object.entries(DEMO_SUBMISSIONS).filter(([, s]) => s.graded_at);
    expect(marked.length).toBeGreaterThan(0);
    for (const [homeworkId, sub] of marked) {
      const questions = DEMO_QUESTIONS[homeworkId] ?? [];
      const answers = questions.map((q) => DEMO_ANSWERS[q.id]);
      expect({ homeworkId, answered: answers.every((a) => a?.submission_id === sub.id) }).toEqual({
        homeworkId,
        answered: true,
      });
      const awarded = answers.reduce((sum, a) => sum + (a?.awarded_marks ?? 0), 0);
      const total = questions.reduce((sum, q) => sum + q.marks, 0);
      const pct = Math.round((100 * awarded) / total);
      expect({ homeworkId, score: sub.score_pct, grade: sub.grade }).toEqual({
        homeworkId,
        score: pct,
        grade: String(gradeFromPct(pct)),
      });
    }
  });

  test("work still being marked has no marks yet", () => {
    for (const [homeworkId, sub] of Object.entries(DEMO_SUBMISSIONS)) {
      if (sub.graded_at) continue;
      for (const q of DEMO_QUESTIONS[homeworkId] ?? []) {
        expect(DEMO_ANSWERS[q.id]?.awarded_marks ?? null).toBeNull();
      }
    }
  });
});

describe("the showcase's curriculum", () => {
  const homeworkIds = new Set(DEMO_HOMEWORK.map((h) => h.id));
  const setIds = new Set([...DEMO_MCQ_SETS, ...DEMO_MCQ_SETS_LATER].map((s) => s.id));
  const liveIds = new Set(DEMO_LIVE.map((s) => s.id));

  test("every task, quiz and live session a spec point lists resolves", () => {
    for (const [point, content] of Object.entries(DEMO_CURRICULUM_CONTENT)) {
      for (const r of content.resources) {
        if (r.kind === "homework")
          expect({ point, id: r.id, ok: homeworkIds.has(r.id) }).toEqual({
            point,
            id: r.id,
            ok: true,
          });
        if (r.kind === "live_session")
          expect({ point, id: r.id, ok: liveIds.has(r.id) }).toEqual({ point, id: r.id, ok: true });
      }
      for (const s of content.mcqSets) {
        expect({ point, id: s.id, set: setIds.has(s.id), questions: !!DEMO_MCQ[s.id] }).toEqual({
          point,
          id: s.id,
          set: true,
          questions: true,
        });
      }
    }
  });

  test("every live session is listed on the points it covers", () => {
    for (const s of DEMO_LIVE) {
      expect(s.specPoints.length).toBeGreaterThan(0);
      for (const p of s.specPoints) {
        const listed = DEMO_CURRICULUM_CONTENT[p.id]?.resources.some((r) => r.id === s.id);
        expect({ session: s.id, point: p.id, listed }).toEqual({
          session: s.id,
          point: p.id,
          listed: true,
        });
      }
    }
  });
});

describe("the showcase's live lessons", () => {
  test("each subject has a lesson to come with a join link, and one from the last week", () => {
    const now = Date.now();
    const finished = (s: (typeof DEMO_LIVE)[number]) =>
      new Date(s.starts_at).getTime() + LIVE_TAIL_MS <= now;
    for (const subject of DEMO_SUBJECTS) {
      const mine = DEMO_LIVE.filter((s) => s.subject === subject);
      const next = mine.filter((s) => !finished(s));
      const last = mine.filter(finished);
      expect({ subject, next: next.length, last: last.length }).toEqual({
        subject,
        next: 1,
        last: 1,
      });
      expect(next[0].join_url).toBeTruthy();
      expect(new Date(next[0].starts_at).getTime() - now).toBeLessThanOrEqual(7 * DAY_MS);
      expect(now - new Date(last[0].starts_at).getTime()).toBeLessThanOrEqual(7 * DAY_MS);
    }
  });
});

describe("the showcase's quizzes", () => {
  test("every set has five questions, each with a valid answer and an explanation", () => {
    for (const [id, { set, questions }] of Object.entries(DEMO_MCQ)) {
      expect(set.id).toBe(id);
      expect({ id, count: questions.length }).toEqual({ id, count: 5 });
      for (const q of questions) {
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(Number.isInteger(q.correct_index)).toBe(true);
        expect(q.correct_index).toBeGreaterThanOrEqual(0);
        expect(q.correct_index).toBeLessThan(q.options.length);
        expect(q.explanation?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  test("every set listed has questions, and every attempt is on a listed set", () => {
    for (const s of [...DEMO_MCQ_SETS, ...DEMO_MCQ_SETS_LATER])
      expect(DEMO_MCQ[s.id]).toBeDefined();
    for (const [id, a] of Object.entries(DEMO_MCQ_ATTEMPTS)) {
      expect(DEMO_MCQ_SETS.some((s) => s.id === id)).toBe(true);
      expect(a.total).toBe(DEMO_MCQ[id].questions.length);
    }
  });
});

describe("the showcase's progress numbers", () => {
  test("each subject has enough work to predict from, and the fixed grade is the one it gives", () => {
    const derived = summariseAnalytics(
      DEMO_SUBJECTS,
      DEMO_SCORED_WORK.quizzes,
      DEMO_SCORED_WORK.tasks,
    );
    expect(DEMO_ANALYTICS).toEqual(derived);
    for (const row of DEMO_ANALYTICS)
      expect(row.mcqAttempts + row.hwGraded).toBeGreaterThanOrEqual(3);
  });

  test("the counts match what Alex's own pages list", () => {
    for (const row of DEMO_ANALYTICS) {
      const quizzes = DEMO_MCQ_SETS.filter(
        (s) => s.subject === row.subject && DEMO_MCQ_ATTEMPTS[s.id],
      ).length;
      const marked = DEMO_HOMEWORK.filter(
        (h) => h.subject === row.subject && DEMO_SUBMISSIONS[h.id]?.graded_at,
      ).length;
      expect({ subject: row.subject, quizzes: row.mcqAttempts, marked: row.hwGraded }).toEqual({
        subject: row.subject,
        quizzes,
        marked,
      });
    }
  });
});
