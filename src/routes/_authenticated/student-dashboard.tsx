import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { isDemoStudent, DEMO_STUDENT_NAME } from "@/lib/demo/studentDemo";
import { resolveDisplayName } from "@/lib/displayName";
import { useState, useEffect } from "react";
import { WeeklyFocusCard } from "@/components/weekly/WeeklyFocusCard";
import { LiveSessionsBanner } from "@/components/live/LiveSessionsBanner";
import { WeeklyPlanPanel } from "@/components/planner/WeeklyPlanPanel";
import { AuthService } from "@/lib/authService";
import { UserRole } from "@/types/user";

export const Route = createFileRoute("/_authenticated/student-dashboard")({
  beforeLoad: async () => {
    // Student surface. Tutors/admins own the Studio and parents own the Portal;
    // each is routed to their own home rather than rendering a student page in
    // their session. An unresolved role falls through to the student view, which
    // matches the safe fallback in dashboard.tsx and avoids a redirect loop.
    const role = await AuthService.getUserRole();
    if (role === UserRole.TUTOR || role === UserRole.ADMIN) {
      throw redirect({ to: "/tutor" });
    }
    if (role === UserRole.PARENT) {
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

const boardLabel: Record<string, string> = {
  edexcel: "Edexcel",
  aqa: "AQA",
  ocr: "OCR",
};

const levelLabel: Record<string, string> = {
  gcse: "GCSE",
  alevel: "A-Level",
};

export function StudentDashboard() {
  const { email } = useRoles();
  const { enrolledCourses, enrolments, level, displayName: profileName } = useEnrolments();
  const [effectiveStudentId, setEffectiveStudentId] = useState<string | null>(null);

  useEffect(() => {
    AuthService.getEffectiveStudentId().then((id) => {
      setEffectiveStudentId(id);
    });
  }, []);

  // Warms the analytics cache for the pages that render it.
  useAnalytics(effectiveStudentId, enrolledCourses);

  // The showcase greets its fixture persona; a real session uses the name from
  // the profile, falling back to the email only when none has been set.
  const displayName = isDemoStudent() ? DEMO_STUDENT_NAME : resolveDisplayName(profileName, email);

  return (
    <AppLayout title="Student Dashboard">
      {/* Slim welcome ribbon — name on the left, the student's actual level and
          per-subject exam boards on the right. */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white px-5 py-4 sm:px-6 sm:py-5 mb-6 relative overflow-hidden border border-slate-800 shadow-sm">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 30% 20%, white 1.5px, transparent 1.5px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-white">
              Welcome back, {displayName}
            </h2>
          </div>
          <EnrolmentSummary enrolments={enrolments} level={level} />
        </div>
      </div>

      {/* Live sessions — hoisted out of the "This Week" hub into its own banner so
          it stands apart from the study plan below. */}
      <LiveSessionsBanner />

      {/* The student's personalised weekly plan — the spaced-repetition-driven
          "this week" the platform builds from their confidence + results, with the
          end-of-week review and the tutor's take. The forward-looking programme and
          termly confidence board live on the Planner tab. */}
      {effectiveStudentId && level && (
        <div className="mt-6">
          <WeeklyPlanPanel studentId={effectiveStudentId} enrolments={enrolments} level={level} />
        </div>
      )}

      {/* "This Week" hub — the curriculum focus the tutor set for the current
          Mon–Sun week, plus curated videos and links to homework, MCQs and live
          sessions. Live strip suppressed here since it now has its own banner. */}
      <WeeklyFocusCard subjects={enrolledCourses} showLive={false} />
    </AppLayout>
  );
}

/**
 * Compact enrolment readout for the welcome ribbon: a shared level chip plus one
 * pill per subject showing its exam board. Boards can differ per subject, so
 * they're always shown alongside the subject rather than collapsed.
 */
function EnrolmentSummary({
  enrolments,
  level,
}: {
  enrolments: { subject: string; board: string }[];
  level: string | null;
}) {
  if (enrolments.length === 0) {
    return (
      <p className="text-xs sm:text-sm text-slate-300">
        You're not enrolled in any subjects yet — contact your tutor to get set up.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {level && (
        <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-md bg-emerald-400/15 text-emerald-300 border border-emerald-400/20">
          {levelLabel[level] ?? level}
        </span>
      )}
      {enrolments.map((e) => (
        <span
          key={e.subject}
          className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium px-2.5 py-1 rounded-md bg-white/10 border border-white/10 text-slate-100"
        >
          {subjectLabel[e.subject] ?? e.subject}
          <span className="text-slate-400">·</span>
          <span className="text-slate-300">{boardLabel[e.board] ?? e.board}</span>
        </span>
      ))}
    </div>
  );
}
