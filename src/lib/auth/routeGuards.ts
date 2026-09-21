import { redirect } from "@tanstack/react-router";
import { isStaffRole, type GuardState } from "@/lib/auth/guardState";
import { UserRole } from "@/types/user";

/**
 * Role guards for the routes under `/_authenticated`.
 *
 * Every one of these reads the viewer the parent guard already resolved and put
 * on the route context. They used to call `AuthService.getUserRole()` instead,
 * which validated the session and read two tables *again* — three more round
 * trips on every click, in series, before the page could start loading — and
 * answered "student" whenever one of those reads failed. Reaching the dashboard
 * was a dozen requests. It is now none, and the role a child guard acts on is
 * by construction the one the parent guard acted on.
 */
type GuardArgs = { context: { viewer?: GuardState } };

function roleOf({ context }: GuardArgs): UserRole {
  // Outside /_authenticated there is no viewer; the student fallback matches
  // `resolveAppRole` and keeps these guards inert rather than throwing.
  return context.viewer?.appRole ?? UserRole.STUDENT;
}

/**
 * `beforeLoad` guard for the student learning sections — planner, curriculum,
 * homework, live, and mcqs (see `STUDENT_SECTION_ROUTES` in `@/lib/shell/nav`).
 *
 * These render the caller's *own* study surface, which a parent does not have:
 * the Parent Portal already surfaces the child's equivalents read-only. A
 * parent who reaches one of these routes by any means — a typed URL, a stale
 * bookmark, the browser back button, a nav link that slipped through — is
 * redirected to their Portal. This is the routing-layer half of the invariant
 * enforced at compile time by `ParentNavRoute`: a student section can never
 * render inside a parent session, even if it were re-added to the sidebar.
 */
export function guardStudentSection(args: GuardArgs) {
  if (roleOf(args) === UserRole.PARENT) {
    throw redirect({ to: "/parent-dashboard" });
  }
}

/** `/dashboard` is an address, not a page: it forwards each role to its own home. */
export function redirectToRoleHome(args: GuardArgs): never {
  const role = roleOf(args);
  if (isStaffRole(role)) {
    // Tutor home is the Tutor Studio (resource management). Tutors must never
    // land on the Parent Portal — that surface is PARENT-only.
    throw redirect({ to: "/tutor" });
  }
  if (role === UserRole.PARENT) {
    throw redirect({ to: "/parent-dashboard" });
  }
  // Students and the safe fallback both resolve to the student dashboard.
  throw redirect({ to: "/student-dashboard" });
}

/**
 * Student surface. Tutors/admins own the Studio and parents own the Portal;
 * each is routed to their own home rather than rendering a student page in
 * their session. An unresolved role falls through to the student view, which
 * matches the fallback in {@link redirectToRoleHome} and avoids a redirect loop.
 */
export function guardStudentHome(args: GuardArgs) {
  const role = roleOf(args);
  if (isStaffRole(role)) throw redirect({ to: "/tutor" });
  if (role === UserRole.PARENT) throw redirect({ to: "/parent-dashboard" });
}

/**
 * PARENT-only surface. Tutors/students are routed away so the Parent Portal can
 * never render inside a tutor or student session.
 *
 * A role that could not be *read* (`role: null`) is left where it is. Sending it
 * to `/dashboard` lands on the student fallback, so a parent whose connection
 * blipped was shown an empty student dashboard in place of their Portal. Nothing
 * is exposed by staying: every read on the page is scoped by RLS to the caller's
 * own linked children.
 */
export function guardParentOnly(args: GuardArgs) {
  const viewer = args.context.viewer;
  if (viewer && viewer.role === null) return;
  if (roleOf(args) !== UserRole.PARENT) {
    throw redirect({ to: "/dashboard" });
  }
}
