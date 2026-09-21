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
