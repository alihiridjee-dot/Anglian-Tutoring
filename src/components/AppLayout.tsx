import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ClipboardList,
  GraduationCap,
  LogOut,
  Wrench,
  BookMarked,
  CreditCard,
  Eye,
  ListChecks,
  Video,
  ArrowLeft,
  ArrowRight,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRoles, setViewAs } from "@/hooks/useRole";
import { toast } from "sonner";

const studentNav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/curriculum", label: "Curriculum", icon: BookMarked },
  { to: "/homework", label: "Homework & Grades", icon: ClipboardList },
  { to: "/live", label: "Live Sessions", icon: Video },
  { to: "/mcqs", label: "MCQs", icon: ListChecks },
  { to: "/billing", label: "Billing", icon: CreditCard },
] as const;

const tutorExtra = [
  { to: "/tutor", label: "Tutor Studio", icon: Wrench },
  { to: "/students", label: "Students", icon: Users },
] as const;

export function AppLayout({ title, children }: { title: string; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isTutor, actualIsTutor, email, viewAs } = useRoles();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();

  const nav = isTutor ? [...studentNav, ...tutorExtra] : studentNav;

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
            Anglian
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
