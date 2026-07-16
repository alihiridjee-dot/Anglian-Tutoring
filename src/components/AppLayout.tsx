import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ClipboardList,
  GraduationCap,
  LogOut,
  BookMarked,
  ListChecks,
  Video,
  ArrowLeft,
  ArrowRight,
  Users,
  Sparkles,
} from "lucide-react";
import { type ReactNode } from "react";
import { useRoles } from "@/hooks/useRole";
import { useSignOut } from "@/hooks/useSignOut";
import { isDemoMode, getDemoRole } from "@/lib/auth/session";
import { DEMO_STUDENT_NAME, DEMO_PARENT_NAME } from "@/lib/demo/studentDemo";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { NotificationBell } from "@/components/NotificationBell";
import { UserMenu } from "@/components/UserMenu";
import { resolveInitials } from "@/lib/displayName";

interface NavItem {
  to:
    | "/dashboard"
    | "/curriculum"
    | "/homework"
    | "/live"
    | "/mcqs"
    | "/tutor"
    | "/students"
    | "/parents"
    | "/student-dashboard"
    | "/parent-dashboard"
    | "/demo/student/dashboard"
    | "/demo/student/curriculum"
    | "/demo/student/homework"
    | "/demo/student/live"
    | "/demo/student/mcqs"
    | "/demo/parent/dashboard";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const studentNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/curriculum", label: "Curriculum", icon: BookMarked },
  { to: "/homework", label: "Homework & Grades", icon: ClipboardList },
  { to: "/live", label: "Live Sessions", icon: Video },
  { to: "/mcqs", label: "MCQs", icon: ListChecks },
];

const tutorExtra: NavItem[] = [{ to: "/students", label: "Students", icon: Users }];

/**
 * Shown to students and parents, never tutors — it manages the caller's own
 * family links, which a tutor doesn't have. Tutors link families from Students.
 * Mirrors the "Linked Parents" item in the header menu, same destination.
 */
const linkedParentsNav: NavItem = { to: "/parents", label: "Linked Parents", icon: Users };

export function AppLayout({ title, children }: { title: string; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isTutor, email } = useRoles();
  const { role: userRole, displayName: profileName } = useEnrolments();
  const navigate = useNavigate();
  const router = useRouter();
  const signOut = useSignOut();

  // Derived from the pathname, so it tracks navigation with no state to go
  // stale and nothing to clear on the way out.
  const isDemo = isDemoMode();
  const demoRole = getDemoRole();

  const handleExitDemo = () => {
    // Nothing to tear down: the showcase holds no session and no cached rows.
    navigate({ to: "/" });
  };

  const nav = isDemo
    ? // Showcase nav must stay inside /demo/*, or a click lands on a guarded
      // route and bounces the visitor to /auth.
      demoRole === "parent"
      ? [{ to: "/demo/parent/dashboard", label: "Parent Portal", icon: LayoutDashboard }]
      : [
          { to: "/demo/student/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { to: "/demo/student/curriculum", label: "Curriculum", icon: BookMarked },
          { to: "/demo/student/homework", label: "Homework & Grades", icon: ClipboardList },
          { to: "/demo/student/live", label: "Live Sessions", icon: Video },
          { to: "/demo/student/mcqs", label: "MCQs", icon: ListChecks },
        ]
    : isTutor
      ? // Tutor home is the Tutor Studio; the shared content pages stay available.
        [
          ...studentNav.map((item) =>
            item.to === "/dashboard" ? { ...item, to: "/tutor" as const } : item,
          ),
          ...tutorExtra,
        ]
      : [
          ...studentNav.map((item) => {
            if (item.to === "/dashboard") {
              // Only a genuine PARENT persona maps to the Parent Portal; everyone
              // else resolves to the student dashboard, so the Parent Portal can
              // never leak into a non-parent session's navigation.
              const home =
                userRole === "parent"
                  ? ("/parent-dashboard" as const)
                  : ("/student-dashboard" as const);
              return { ...item, to: home };
            }
            return item;
          }),
          linkedParentsNav,
        ];

  // The showcase has no account, so its avatar comes from the fixture persona
  // rather than a signed-in profile.
  const initials = isDemo
    ? (demoRole === "parent" ? DEMO_PARENT_NAME : DEMO_STUDENT_NAME).slice(0, 2).toUpperCase()
    : resolveInitials(profileName, email);

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-20 lg:w-60 bg-sidebar border-r border-sidebar-border flex flex-col py-5 px-3 gap-1 shrink-0">
        <Link to="/" className="flex items-center gap-2 px-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="hidden lg:inline font-display font-semibold tracking-tight text-foreground">
            Anglian Learning
          </span>
        </Link>
        {nav.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="hidden lg:inline">{label}</span>
            </Link>
          );
        })}
        <div className="mt-auto">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10"
          >
            <LogOut className="w-5 h-5" />
            <span className="hidden lg:inline">Sign out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {isDemo && (
          <div className="bg-slate-900 text-white px-6 py-2.5 flex flex-col sm:flex-row gap-3 items-center justify-between text-xs font-semibold border-b border-slate-800 shrink-0 select-none shadow-md z-40 bg-gradient-to-r from-slate-900 via-primary-deep to-slate-900">
            <div className="flex flex-wrap items-center gap-2.5 justify-center sm:justify-start">
              <span className="inline-flex items-center gap-1 bg-amber-500 text-slate-950 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider animate-pulse shrink-0">
                <Sparkles className="w-3 h-3 fill-slate-950" />{" "}
                {demoRole === "student" ? "STUDENT" : "PARENT"} DEMO MODE
              </span>
              <span className="text-slate-200 text-center sm:text-left leading-relaxed">
                {demoRole === "student"
                  ? "Exploring the GCSE Science Student Hub as a student. Check out curriculum, live classes, quizzes, and homework!"
                  : "Exploring the GCSE Science Student Hub. Click around to preview live classes, grades, worksheets, and syllabus views!"}
              </span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <Link
                to="/"
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-lg font-bold text-xs shadow-xs transition shrink-0"
              >
                Join Now
              </Link>
              <button
                onClick={handleExitDemo}
                className="bg-white/10 hover:bg-white/20 text-white border border-white/15 px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer shrink-0"
              >
                Exit Sandbox
              </button>
            </div>
          </div>
        )}
        <header className="flex items-center justify-between px-6 lg:px-10 py-4 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => router.history.back()}
                title="Back"
                className="w-9 h-9 rounded-lg border border-border hover:bg-muted flex items-center justify-center"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => router.history.forward()}
                title="Forward"
                className="w-9 h-9 rounded-lg border border-border hover:bg-muted flex items-center justify-center"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div>
              <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight">
                {title}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <UserMenu
              initials={initials}
              email={email}
              // Tutors manage families from /students; the item would point a
              // tutor at a page about their own parents, which they don't have.
              showLinkedParents={!isTutor}
              isDemo={isDemo}
            />
          </div>
        </header>
        <div className="flex-1 p-6 lg:p-10 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
