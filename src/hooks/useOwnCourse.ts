import { useEntitlements } from "@/hooks/data/useEntitlements";
import { useSearchContext } from "@/hooks/useGlobalSearch";
import { onOwnCourse } from "@/lib/search/globalSearch";

type CourseRow = { subject?: string | null; board?: string | null; level?: string | null };

/**
 * For a page that opens one quiz, task, video or spec point from a link:
 * is it on the signed-in student's own course? The database shows a student
 * everything in a subject they take, every board and level, so this is where
 * a link to another course's item is turned away. Tutors, parents and the
 * showcase are never turned away.
 */
export function useOwnCourse() {
  const ctx = useSearchContext();
  const { loading } = useEntitlements();
  const open = ctx.isTutor || ctx.isDemo;
  const guarded = !open && ctx.role === "student";
  return {
    /** False until the profile and courses have loaded: decide nothing before. */
    ready: open || !loading,
    /** A signed-in student, the only reader ever turned away. */
    guarded,
    onCourse: (row: CourseRow) => !guarded || onOwnCourse(ctx, row),
  };
}
