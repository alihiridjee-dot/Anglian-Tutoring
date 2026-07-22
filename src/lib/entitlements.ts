import { useMemo } from "react";
import { SUBJECTS, type SubjectV, type BoardV } from "@/lib/taxonomy";
import { useEnrolments } from "@/hooks/data/useEnrolments";

/**
 * The one place that answers "which subjects is this user allowed to see?".
 *
 * Access is subject-scoped: a student may only view material for the subjects
 * their active subscription pays for. That paid set is `profiles.enrolled_courses`
 * (kept in lockstep with the plan by onboarding and the add-subject upgrade), and
 * it is the same set the server RLS on topics/spec_points/resources enforces — so
 * the client greying here and the database guardrail can never disagree.
 *
 * Tutors are unscoped: they author across every subject.
 */

/** The most subjects any single plan covers (Combined Trilogy = 3). */
export const PLAN_MAX_SUBJECTS = 3;

export type Cadence = "weekly" | "monthly" | "termly";

/** Billing cadences of the `${cadence}_${count}` tier matrix, in display order. */
export const CADENCES: { key: Cadence; label: string; unit: string }[] = [
  { key: "weekly", label: "Weekly", unit: "per week" },
  { key: "monthly", label: "Monthly", unit: "per month" },
  { key: "termly", label: "Termly", unit: "per term" },
];

/**
 * How many subjects a plan tier covers. Tiers are `${cadence}_${count}` (e.g.
 * "monthly_2"), so the count is the trailing number; anything unparseable falls
 * back to 1 so a live plan never reads as covering zero subjects.
 */
export function planSubjectCount(tier: string | null | undefined): number {
  const n = Number(String(tier ?? "").split("_")[1]);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, PLAN_MAX_SUBJECTS);
}

/** The billing cadence a tier belongs to, or null if it isn't one of ours. */
export function planCadence(tier: string | null | undefined): Cadence | null {
  const head = String(tier ?? "").split("_")[0];
  return CADENCES.some((c) => c.key === head) ? (head as Cadence) : null;
}

/** The tier id for a cadence at a given subject count. */
export function tierFor(cadence: Cadence, count: number): string {
  return `${cadence}_${Math.min(Math.max(count, 1), PLAN_MAX_SUBJECTS)}`;
}

export interface Entitlements {
  loading: boolean;
  /** True for tutors — they see every subject, ungated. */
  unrestricted: boolean;
  /** Subjects the user is entitled to (their paid enrolment). */
  entitledSubjects: SubjectV[];
  /** Subjects that exist but this user isn't entitled to (greyed / upsell). */
  lockedSubjects: SubjectV[];
  /** Board the user sits each entitled subject with. */
  boardBySubject: Record<string, BoardV | undefined>;
  /** Is this subject viewable by the current user? */
  isEntitled: (subject: string) => boolean;
}

/**
 * Resolves the current user's subject entitlements from their enrolment. Use
 * this to gate any subject-scoped surface (curriculum, planner filters, …) so
 * the rule lives in one place rather than being re-derived per page.
 */
export function useEntitlements(): Entitlements {
  const { enrolledCourses, enrolments, role, loading } = useEnrolments();

  return useMemo(() => {
    const unrestricted = role === "tutor";
    const allSubjects = SUBJECTS.map((s) => s.value);

    const entitledSubjects = (
      unrestricted ? allSubjects : allSubjects.filter((s) => enrolledCourses.includes(s))
    ) as SubjectV[];
    const entitledSet = new Set<string>(entitledSubjects);
    const lockedSubjects = allSubjects.filter((s) => !entitledSet.has(s)) as SubjectV[];

    const boardBySubject: Record<string, BoardV | undefined> = {};
    for (const e of enrolments) boardBySubject[e.subject] = e.board;

    return {
      loading,
      unrestricted,
      entitledSubjects,
      lockedSubjects,
      boardBySubject,
      isEntitled: (subject: string) => unrestricted || entitledSet.has(subject),
    };
  }, [enrolledCourses, enrolments, role, loading]);
}
