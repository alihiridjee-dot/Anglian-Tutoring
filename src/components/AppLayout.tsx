import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ClipboardList,
  GraduationCap,
  LogOut,
  Wrench,
  BookMarked,
  Eye,
  ListChecks,
  Video,
  ArrowLeft,
  ArrowRight,
  Users,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRoles, setViewAs } from "@/hooks/useRole";
import { isDemoMode, getDemoRole, clearDemoSession, type DemoRole } from "@/lib/auth/session";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { toast } from "sonner";

interface NavItem {
  to:
    | "/dashboard"
    | "/curriculum"
    | "/homework"
    | "/live"
    | "/mcqs"
    | "/tutor"
    | "/students"
    | "/student-dashboard"
    | "/parent-dashboard";
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

export function AppLayout({ title, children }: { title: string; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isTutor, actualIsTutor, email, viewAs } = useRoles();
  const { role: userRole } = useEnrolments();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();

  const [isDemo, setIsDemo] = useState(false);
  const [demoRole, setDemoRole] = useState<DemoRole | null>(null);
  useEffect(() => {
    setIsDemo(isDemoMode());
    setDemoRole(getDemoRole());
  }, []);

  const handleExitDemo = async () => {
    clearDemoSession();
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Exited demo sandbox");
    navigate({ to: "/" });
  };

  const nav = isTutor
    ? // Tutor home is the Tutor Studio; the shared content pages stay available.
      [
        ...studentNav.map((item) =>
          item.to === "/dashboard" ? { ...item, to: "/tutor" as const } : item,
        ),
        ...tutorExtra,
      ]
    : studentNav.map((item) => {
        if (item.to === "/dashboard") {
          // Only a genuine PARENT persona maps to the Parent Portal. Everyone
          // else — students, and tutors previewing as a student — resolves to
          // the student dashboard, so the Parent Portal can never leak into a
          // non-parent session's navigation.
          const activeRole = isDemo ? demoRole : userRole;
          const home = activeRole === "parent" ? "/parent-dashboard" : "/student-dashboard";
          return { ...item, to: home as const };
        }
        return item;
      });

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/", replace: true });
  };

  const initials = (email ?? "?").slice(0, 2).toUpperCase();

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
                onClick={clearDemoSession}
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
              {actualIsTutor && !isTutor && (
                <span className="text-[10px] uppercase tracking-widest text-accent font-semibold">
                  Previewing as student
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {actualIsTutor && (
              <div className="flex items-center gap-1 p-1 bg-muted rounded-lg border border-border">
                <button
                  onClick={() => setViewAs("tutor")}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold ${viewAs === "tutor" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  <Wrench className="w-3 h-3 inline mr-1" /> Tutor
                </button>
                <button
                  onClick={() => setViewAs("student")}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold ${viewAs === "student" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >
                  <Eye className="w-3 h-3 inline mr-1" /> Preview as student
                </button>
              </div>
            )}
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-semibold text-primary-foreground">
              {initials}
            </div>
          </div>
        </header>
        <div className="flex-1 p-6 lg:p-10 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
