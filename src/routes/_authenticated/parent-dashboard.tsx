import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { AuthService } from "@/lib/authService";
import { UserRole } from "@/types/user";
import { useState, useEffect } from "react";
import {
  CalendarClock,
  ClipboardList,
  Wrench,
  BookMarked,
  ListChecks,
  CreditCard,
  Download,
  Users,
  CheckCircle2,
  MessageSquare,
  Award,
  Clock,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export const Route = createFileRoute("/_authenticated/parent-dashboard")({
  beforeLoad: async () => {
    const hasAccess = await AuthService.verifyRoleAccess([
      UserRole.PARENT,
      UserRole.TUTOR,
      UserRole.ADMIN,
    ]);
    if (!hasAccess) {
      throw redirect({ to: "/student-dashboard" });
    }
  },
  head: () => ({ meta: [{ title: "Parent Portal | Anglian Learning" }] }),
  component: ParentDashboard,
});

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

const subjectColor: Record<string, string> = {
  biology: "text-rose-600 bg-rose-50 border-rose-100",
  chemistry: "text-emerald-600 bg-emerald-50 border-emerald-100",
  physics: "text-blue-600 bg-blue-50 border-blue-100",
};

const trendData = [
  { week: "Wk 1", Biology: 72, Chemistry: 68, Physics: 60 },
  { week: "Wk 2", Biology: 78, Chemistry: 70, Physics: 62 },
  { week: "Wk 3", Biology: 80, Chemistry: 72, Physics: 58 },
  { week: "Wk 4", Biology: 85, Chemistry: 74, Physics: 60 },
  { week: "Wk 5", Biology: 84, Chemistry: 76, Physics: 62 },
  { week: "Wk 6", Biology: 88, Chemistry: 78, Physics: 65 },
];

const chartConfig = {
  Biology: {
    label: "Biology",
    color: "var(--color-biology, #e11d48)",
  },
  Chemistry: {
    label: "Chemistry",
    color: "var(--color-chemistry, #059669)",
  },
  Physics: {
    label: "Physics",
    color: "var(--color-physics, #2563eb)",
  },
} satisfies ChartConfig;

function ParentDashboard() {
  const { isTutor, actualIsTutor, email } = useRoles();
  const { enrolledCourses } = useEnrolments();
  const [effectiveStudentId, setEffectiveStudentId] = useState<string | null>(null);

  useEffect(() => {
    AuthService.getEffectiveStudentId().then((id) => {
      setEffectiveStudentId(id);
    });
  }, []);

  const { rows: analytics } = useAnalytics(effectiveStudentId, enrolledCourses);

  const displaySubjects =
    actualIsTutor && isTutor ? ["biology", "chemistry", "physics"] : enrolledCourses;

  const displayEmailName = email
    ? email.startsWith("demo")
      ? "Sarah (Parent)"
      : email.split("@")[0]
    : "Parent";

  const handleDownloadReport = () => {
    toast.success("Preparing monthly progress report PDF for Alex...", {
      description: "Download will begin in a few seconds.",
    });
  };

  const handleContactTutor = (subject: string) => {
    toast.success(`Opening messenger query to ${subjectLabel[subject] || subject} tutor...`, {
      description: "A secure chat session has been requested.",
    });
  };

  return (
    <AppLayout title="Parent Portal">
      {/* Welcome Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-deep text-primary-foreground p-8 mb-8 relative overflow-hidden shadow-sm">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 30% 20%, white 1.5px, transparent 1.5px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="flex flex-wrap items-center gap-2 mb-2 relative">
          <Users className="w-4 h-4 text-primary-foreground/80" />
          <span className="text-xs uppercase tracking-widest text-primary-foreground/80 font-semibold">
            Parent Workspace
          </span>
        </div>
        <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight relative">
          Welcome back, {displayEmailName}
        </h2>
        <p className="mt-2 text-primary-foreground/90 max-w-2xl relative">
          Keep track of your child’s science progress, predicted grades, attendance logs, and
          personalized tutor feedback all in one place.
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5 relative">
          <button
            onClick={handleDownloadReport}
            className="inline-flex items-center gap-2 bg-primary-foreground text-primary hover:bg-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Download className="w-4 h-4" /> Download Progress Report
          </button>
          {isTutor && (
            <Link
              to="/tutor"
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-xs font-semibold border border-white/20 transition cursor-pointer"
            >
              <Wrench className="w-4 h-4" /> Open Tutor Studio
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Grade Predictor Cards */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  GCSE Science Grade Predictor
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Grades (1-9) predicted from combined live quiz results and completed homework
                  sets.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500" /> Fully Updated
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {analytics.map((subjectRow) => {
                const colors =
                  subjectColor[subjectRow.subject] ?? "text-slate-600 bg-slate-50 border-slate-100";
                return (
                  <div
                    key={subjectRow.subject}
                    className="border border-border/60 rounded-xl p-5 hover:border-primary/20 transition bg-linear-to-b from-white to-slate-50/50"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <span
                        className={`text-xs font-bold uppercase px-2 py-0.5 rounded-md border ${colors}`}
                      >
                        {subjectLabel[subjectRow.subject] ?? subjectRow.subject}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-4xl font-display font-extrabold text-slate-900">
                        Grade {subjectRow.predictedGrade}
                      </span>
                    </div>

                    <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
                      Calculated from {subjectRow.mcqAttempts + subjectRow.hwGraded} completed
                      grading markers with high reliability.
                    </p>

                    <div className="space-y-2 text-xs border-t border-slate-100 pt-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Quiz Average:</span>
                        <span className="font-semibold text-slate-800">
                          {subjectRow.mcqAverage}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Homework Average:</span>
                        <span className="font-semibold text-slate-800">
                          {subjectRow.hwAverage}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Interactive Performance Charts */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Performance Trends
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Track student quiz averages over the past six teaching units.
                </p>
              </div>
              <div className="flex gap-4 text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5 text-rose-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Biology
                </span>
                <span className="inline-flex items-center gap-1.5 text-emerald-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Chemistry
                </span>
                <span className="inline-flex items-center gap-1.5 text-blue-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Physics
                </span>
              </div>
            </div>

            <div className="h-64">
              <ChartContainer config={chartConfig}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="week"
                      tickLine={false}
                      axisLine={false}
                      dy={10}
                      style={{ fontSize: "11px", fill: "#64748b" }}
                    />
                    <YAxis
                      domain={[50, 100]}
                      tickLine={false}
                      axisLine={false}
                      dx={-5}
                      style={{ fontSize: "11px", fill: "#64748b" }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="Biology"
                      stroke="#f43f5e"
                      strokeWidth={2.5}
                      dot={{ r: 4, strokeWidth: 0, fill: "#f43f5e" }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="Chemistry"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={{ r: 4, strokeWidth: 0, fill: "#10b981" }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="Physics"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      dot={{ r: 4, strokeWidth: 0, fill: "#3b82f6" }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </div>
        </div>

        {/* Right Column: Attendance & Tutor Remarks */}
        <div className="space-y-8">
          {/* Attendance logs */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <h3 className="font-display text-lg font-bold text-slate-900 mb-5">Engagement Stats</h3>
            <div className="space-y-5">
              <div>
                <div className="flex justify-between items-center text-xs font-semibold mb-2">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-slate-400" /> Live Class Attendance
                  </span>
                  <span className="text-slate-900">94%</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-primary h-full rounded-full" style={{ width: "94%" }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Alex attended 15 of 16 live interactive lecture classes.
                </p>
              </div>

              <div>
                <div className="flex justify-between items-center text-xs font-semibold mb-2">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Homework Completed
                  </span>
                  <span className="text-emerald-600">100%</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: "100%" }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  All 6 assigned homework challenges submitted and marked.
                </p>
              </div>
            </div>
          </div>

          {/* Tutor feedback and remarks */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-lg font-bold text-slate-900">Tutor Feedback</h3>
              <Award className="w-5 h-5 text-amber-500" />
            </div>

            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-rose-600">Biology Review</span>
                  <span className="text-[10px] text-slate-400">4 days ago</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed italic">
                  "Alex did brilliantly with human respiration structures. He has perfect recall on
                  the circulatory cycles and metabolic calculations."
                </p>
                <div className="mt-3 flex justify-between items-center border-t border-slate-100 pt-3">
                  <span className="text-[10px] text-slate-500">Tutor: Chris M.</span>
                  <button
                    onClick={() => handleContactTutor("biology")}
                    className="text-[10px] text-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <MessageSquare className="w-3 h-3" /> Reply
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-blue-600">Physics Review</span>
                  <span className="text-[10px] text-slate-400">1 week ago</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed italic">
                  "Physics electromagnetism quiz showed high understanding (92%). He is reacting
                  extremely well to mock paper practice guides. Keep it up!"
                </p>
                <div className="mt-3 flex justify-between items-center border-t border-slate-100 pt-3">
                  <span className="text-[10px] text-slate-500">Tutor: Chris M.</span>
                  <button
                    onClick={() => handleContactTutor("physics")}
                    className="text-[10px] text-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <MessageSquare className="w-3 h-3" /> Reply
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Portal Shortcut Tiles */}
      <div className="mt-12">
        <h3 className="font-display text-lg font-bold text-slate-900 mb-5">
          Quick Access Portal Links
        </h3>
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
              <p className="font-display font-semibold text-sm">{t.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
            </Link>
          ))}
        </div>
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
