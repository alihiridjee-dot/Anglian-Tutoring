import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import {
  PlayCircle,
  CalendarClock,
  ClipboardList,
  Wrench,
  BookMarked,
  ListChecks,
  CreditCard,
  TrendingUp,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard | Anglian Tutoring" }] }),
  component: Dashboard,
});

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};
const subjectColor: Record<string, string> = {
  biology: "from-accent to-accent/60",
  chemistry: "from-primary to-primary/60",
  physics: "from-primary-deep to-primary",
};

function Dashboard() {
  const { isTutor, actualIsTutor, email, userId } = useRoles();
  const { enrolledCourses, role, inviteCode } = useEnrolments();
  const { rows: analytics } = useAnalytics(userId, enrolledCourses);

  const displaySubjects =
    actualIsTutor && isTutor ? ["biology", "chemistry", "physics"] : enrolledCourses;

  return (
    <AppLayout title="Dashboard">
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-deep text-primary-foreground p-8 mb-6 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 30% 20%, white 1.5px, transparent 1.5px)",
            backgroundSize: "24px 24px",
          }}
        />
        <p className="text-xs uppercase tracking-widest text-primary-foreground/80 font-semibold relative">
          {isTutor ? "Tutor" : role === "parent" ? "Parent" : "Student"}
        </p>
        <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight relative">
          Welcome back{email ? `, ${email.split("@")[0]}` : ""}
        </h2>
        <p className="mt-2 text-primary-foreground/80 relative">
          {isTutor
            ? "Publish material, mark homework, and monitor student progress."
            : role === "parent"
              ? "Track your child's grades, attendance, and predicted GCSE outcomes."
              : displaySubjects.length === 0
                ? "You're not enrolled in any subjects yet — head to Billing to pick a plan."
                : `You're enrolled in ${displaySubjects.map((s) => subjectLabel[s] ?? s).join(", ")}.`}
        </p>
        <div className="mt-5 flex flex-wrap gap-2 relative">
          {isTutor && (
            <Link
              to="/tutor"
              className="inline-flex items-center gap-2 bg-primary-foreground text-primary px-4 py-2 rounded-lg text-sm font-semibold"
            >
              <Wrench className="w-4 h-4" /> Open Tutor Studio
            </Link>
          )}
          {!isTutor && displaySubjects.length === 0 && (
            <Link
              to="/billing"
              className="inline-flex items-center gap-2 bg-primary-foreground text-primary px-4 py-2 rounded-lg text-sm font-semibold"
            >
              <CreditCard className="w-4 h-4" /> Choose a plan
            </Link>
          )}
          {!isTutor && role === "student" && inviteCode && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(inviteCode);
                toast.success("Invite code copied");
              }}
              className="inline-flex items-center gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold border border-primary-foreground/30"
            >
              <Copy className="w-4 h-4" /> Parent invite code: {inviteCode}
            </button>
          )}
        </div>
      </div>

      {/* Predicted grades */}
      {!isTutor && displaySubjects.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="font-display font-semibold">Predicted grades</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {analytics.map((a) => (
              <div key={a.subject} className="rounded-2xl bg-card border border-border p-5">
                <div
                  className={`w-full h-1.5 rounded-full bg-gradient-to-r ${subjectColor[a.subject] ?? "from-primary to-accent"} mb-4`}
                />
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                  {subjectLabel[a.subject] ?? a.subject}
                </p>
                <p className="font-display text-4xl font-bold mt-1">Grade {a.predictedGrade}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  MCQ avg <span className="font-semibold text-foreground">{a.mcqAverage}%</span> ·
                  Homework avg <span className="font-semibold text-foreground">{a.hwAverage}%</span>
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Based on {a.mcqAttempts} quiz{a.mcqAttempts === 1 ? "" : "zes"} + {a.hwGraded}{" "}
                  marked homework{a.hwGraded === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {tiles.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="rounded-2xl bg-card border border-border p-5 hover:border-primary/50 hover:shadow-lg transition"
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
  { to: "/billing", label: "Billing", desc: "Plan & payments", icon: CreditCard },
] as const;
