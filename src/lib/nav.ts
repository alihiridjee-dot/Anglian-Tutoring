import {
  LayoutDashboard,
  ClipboardList,
  BookMarked,
  ListChecks,
  Video,
  Users,
  Compass,
  CreditCard,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ProfileRole } from "@/hooks/data/useEnrolments";

/**
 * Single source of truth for the authenticated sidebar.
 *
 * Navigation is derived here — per persona — rather than assembled ad hoc in
 * the layout, so the rule "a parent never sees a student learning section"
 * lives in one place and is enforced by the type system (see
 * {@link ParentNavRoute}). The route-level guard in `@/lib/routeGuards`
 * mirrors this at the routing layer, so the invariant holds even for a URL
 * typed by hand.
 */

/** Every route the authenticated sidebar can link to. */
export type NavRoute =
  | "/dashboard"
  | "/planner"
  | "/curriculum"
  | "/homework"
  | "/live"
  | "/mcqs"
  | "/tutor"
  | "/students"
  | "/parents"
  | "/billing"
  | "/student-dashboard"
  | "/parent-dashboard";

/**
 * The student learning sections. Each renders the caller's *own* study
 * surface — their planner, curriculum, homework, quizzes, or live classes — so
 * they belong to student (and tutor) sessions only. At the parent level the
 * same information appears read-only inside the Parent Portal, which is why a
 * parent seeing these as separate nav items is redundant.
 *
 * This tuple is the canonical list. Both the compile-time nav guard below and
 * the runtime route guard (`guardStudentSection`) are derived from it, so the
 * two layers can never drift apart.
 */
export const STUDENT_SECTION_ROUTES = [
  "/planner",
  "/curriculum",
  "/homework",
  "/live",
  "/mcqs",
] as const;

export type StudentSectionRoute = (typeof STUDENT_SECTION_ROUTES)[number];

/**
 * Routes a parent's sidebar is permitted to link to: anything EXCEPT a student
 * learning section. `parentNav` is typed to this, so adding e.g. `/planner`
 * back into the parent navigation is a compile error, not a silent regression.
 */
export type ParentNavRoute = Exclude<NavRoute, StudentSectionRoute>;

export interface NavItem<T extends NavRoute = NavRoute> {
  to: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/** The student sidebar. `/dashboard` is swapped to the concrete home per role. */
const studentNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/planner", label: "Planner", icon: Compass },
  { to: "/curriculum", label: "Curriculum", icon: BookMarked },
  { to: "/homework", label: "Homework & Grades", icon: ClipboardList },
  { to: "/live", label: "Live Sessions", icon: Video },
  { to: "/mcqs", label: "MCQs", icon: ListChecks },
];

const tutorExtra: NavItem[] = [{ to: "/students", label: "Students", icon: Users }];

/**
 * Shown to students (never tutors) — it manages the caller's own family links.
 * Tutors link families from Students. Mirrors the "Linked Parents" item in the
 * header menu, same destination.
 */
const linkedParentsNav: NavItem = { to: "/parents", label: "Linked Parents", icon: Users };

/**
 * The parent sidebar: the Portal, billing, and family-link management, and
 * nothing else.
 *
 * Typed to {@link ParentNavRoute}[] — a student learning section cannot be
 * added here without failing typecheck, which is the structural guarantee that
 * the redundant sections can never be re-introduced at the parent level.
 *
 * "Linked Students" (not "Linked Parents"): from a parent's seat the /parents
 * page manages the children they follow, so the label names them, not the
 * parent. The student side keeps "Linked Parents" — see {@link linkedParentsNav}.
 */
const parentNav: NavItem<ParentNavRoute>[] = [
  { to: "/parent-dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/parents", label: "Linked Students", icon: Users },
];

/**
 * Builds the authenticated sidebar for a session.
 *
 * A parent resolves to {@link parentNav} exclusively — the student learning
 * sections are structurally absent, not filtered out. Everything else (student,
 * or role still resolving) gets the student sidebar; a parent who briefly sees
 * it before their role loads is still bounced by `guardStudentSection` on click.
 */
export function buildAuthedNav(opts: { isTutor: boolean; role: ProfileRole | null }): NavItem[] {
  if (opts.isTutor) {
    // Tutor home is the Tutor Studio; the shared content pages stay available.
    return [
      ...studentNav.map((item) =>
        item.to === "/dashboard" ? { ...item, to: "/tutor" as const } : item,
      ),
      ...tutorExtra,
    ];
  }

  if (opts.role === "parent") {
    return parentNav;
  }

  return [
    ...studentNav.map((item) =>
      item.to === "/dashboard" ? { ...item, to: "/student-dashboard" as const } : item,
    ),
    linkedParentsNav,
  ];
}
