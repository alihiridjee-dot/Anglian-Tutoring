import { createFileRoute } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/routeGuards";
import { useEffect, useState } from "react";
import { Compass, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useRoles } from "@/hooks/useRole";
import { AuthService } from "@/lib/authService";
import { StudentPlanner } from "@/components/planner/StudentPlanner";
import { TutorPlannerPanel } from "@/components/planner/TutorPlannerPanel";

export const Route = createFileRoute("/_authenticated/planner")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "My Planner | Anglian Learning" }] }),
  component: PlannerPage,
});

function PlannerPage() {
  const { isTutor, loading: rolesLoading } = useRoles();

  return (
    <AppLayout title={isTutor ? "Student Planner" : "My Planner"}>
      {/* Intro ribbon — one sentence on what this page is for. */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white px-5 py-4 sm:px-6 sm:py-5 mb-6 relative overflow-hidden border border-indigo-700/50 shadow-sm">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 80% 20%, white 1.5px, transparent 1.5px)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight">
              {isTutor ? "Student weekly plans" : "Your plan to the exams"}
            </h2>
            <p className="text-xs sm:text-sm text-indigo-100">
              {isTutor
                ? "Pick a student to review how their week went and adjust their focus."
                : "What to work on this week, the road ahead, and where to rate your topics."}
            </p>
          </div>
        </div>
      </div>

      {rolesLoading ? (
        <div className="rounded-2xl bg-card border border-border p-16 text-center shadow-sm">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : isTutor ? (
        <TutorPlannerPanel />
      ) : (
        <StudentPlannerGate />
      )}
    </AppLayout>
  );
}

function StudentPlannerGate() {
  const { enrolments, level, loading } = useEnrolments();
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    AuthService.getEffectiveStudentId().then(setStudentId);
  }, []);

  if (loading || !studentId) {
    return (
      <div className="rounded-2xl bg-card border border-border p-16 text-center shadow-sm">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }
  if (!level) {
    return (
      <div className="rounded-2xl bg-card border border-border p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">
          Set your exam level in your profile to start planning.
        </p>
      </div>
    );
  }

  return <StudentPlanner studentId={studentId} enrolments={enrolments} level={level} />;
}
