import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { useState, useEffect } from "react";
import { CalendarClock, ClipboardList, Wrench, BookMarked, ListChecks } from "lucide-react";
import { AuthService } from "@/lib/authService";
import { UserRole } from "@/types/user";

export const Route = createFileRoute("/_authenticated/student-dashboard")({
  beforeLoad: async () => {
    const hasAccess = await AuthService.verifyRoleAccess([
      UserRole.STUDENT,
      UserRole.TUTOR,
      UserRole.ADMIN,
    ]);
    if (!hasAccess) {
      throw redirect({ to: "/parent-dashboard" });
    }
  },
  head: () => ({ meta: [{ title: "Student Dashboard | Anglian Learning" }] }),
  component: StudentDashboard,
});

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

function StudentDashboard() {
  const { isTutor, actualIsTutor, email } = useRoles();
  const { enrolledCourses } = useEnrolments();
  const [effectiveStudentId, setEffectiveStudentId] = useState<string | null>(null);

  useEffect(() => {
    AuthService.getEffectiveStudentId().then((id) => {
      setEffectiveStudentId(id);
    });
  }, []);

  const { rows: analytics } = useAnalytics(effectiveStudentId, enrolledCourses);
  const [displayName, setDisplayName] = useState("Ali");

  useEffect(() => {
    const isDemo = localStorage.getItem("studyhub:is-demo") === "true";
    const demoRole = localStorage.getItem("studyhub:demo-role");
    if (isDemo && demoRole === "student") {
      setDisplayName("Ali");
    } else if (email) {
      const parts = email.split("@")[0];
      const name = parts.charAt(0).toUpperCase() + parts.slice(1);
      setDisplayName(name);
    } else {
      setDisplayName("Ali");
    }
  }, [email]);

  const displaySubjects =
    actualIsTutor && isTutor ? ["biology", "chemistry", "physics"] : enrolledCourses;

  return (
    <AppLayout title="Student Dashboard">
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-8 mb-6 relative overflow-hidden border border-slate-800 shadow-sm">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 30% 20%, white 1.5px, transparent 1.5px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <h2 className="font-display text-3xl font-bold tracking-tight text-white">
              Welcome back, <span className="font-extrabold text-white">{displayName}</span>!
            </h2>
          </div>
          <p className="text-sm md:text-base text-slate-300 max-w-2xl mt-1">
            {displaySubjects.length === 0
              ? "You're not enrolled in any subjects yet — please contact your administrator or tutor to get enrolled."
              : `You're enrolled in ${displaySubjects.map((s) => subjectLabel[s] ?? s).join(", ")}.`}
          </p>
        </div>
        {isTutor && (
          <div className="mt-5 flex flex-wrap gap-2 relative">
            <Link
              to="/tutor"
              className="inline-flex items-center gap-2 bg-white text-slate-950 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors"
            >
              <Wrench className="w-4 h-4" /> Open Tutor Studio
            </Link>
          </div>
        )}
      </div>

      {/* Quick tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="rounded-2xl bg-card border border-border p-5 hover:border-primary/50 hover:shadow-lg transition cursor-pointer"
          >
            <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <t.icon className="w-5 h-5 text-primary" />
            </div>
            <p className="font-display font-semibold">{t.label}</p>
            <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
          </Link>
        ))}
      </div>
    </AppLayout>
  );
}

const tiles = [
  { to: "/curriculum", label: "Curriculum", desc: "Topics & spec points", icon: BookMarked },
  { to: "/homework", label: "Homework & Grades", desc: "Submit & track", icon: ClipboardList },
  { to: "/live", label: "Live Sessions", desc: "Upcoming lessons", icon: CalendarClock },
  { to: "/mcqs", label: "MCQs", desc: "Weekly quizzes", icon: ListChecks },
] as const;
