import { redirect } from "@tanstack/react-router";
import { AuthService } from "@/lib/authService";
import { UserRole } from "@/types/user";

/**
 * `beforeLoad` guard for the student learning sections — planner, curriculum,
 * homework, live, and mcqs (see `STUDENT_SECTION_ROUTES` in `@/lib/nav`).
 *
 * These render the caller's *own* study surface, which a parent does not have:
 * the Parent Portal already surfaces the child's equivalents read-only. A
 * parent who reaches one of these routes by any means — a typed URL, a stale
 * bookmark, the browser back button, a nav link that slipped through — is
 * redirected to their Portal. This is the routing-layer half of the invariant
 * enforced at compile time by `ParentNavRoute`: a student section can never
 * render inside a parent session, even if it were re-added to the sidebar.
 */
export async function guardStudentSection() {
  const role = await AuthService.getUserRole();
  if (role === UserRole.PARENT) {
    throw redirect({ to: "/parent-dashboard" });
  }
}
