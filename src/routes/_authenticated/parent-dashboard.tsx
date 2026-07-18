import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useAnalytics } from "@/hooks/data/useAnalytics";
import { useChildLinks } from "@/hooks/data/useParentLinks";
import {
  useChildSubjects,
  useChildTrends,
  useChildEngagement,
  useChildFeedback,
  type WeeklyTrendPoint,
} from "@/hooks/data/useChildProgress";
import { AuthService } from "@/lib/authService";
import { supabase } from "@/integrations/supabase/client";
import { ParentBillingSection } from "@/components/billing/ParentBillingSection";
import { GradePredictorCard } from "@/components/parent/GradePredictorCard";
import { TrendsChart } from "@/components/parent/TrendsChart";
import { EngagementStats } from "@/components/parent/EngagementStats";
import { FeedbackList } from "@/components/parent/FeedbackList";
import { isDemoMode } from "@/lib/auth/session";
import { DEMO_PARENT_NAME } from "@/lib/demo/studentDemo";
import { resolveDisplayName } from "@/lib/displayName";
import { UserRole } from "@/types/user";
import { useState, useEffect } from "react";
import { CalendarClock, ClipboardList, BookMarked, ListChecks, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/parent-dashboard")({
  beforeLoad: async () => {
    // PARENT-only surface. Tutors/students are routed away so the Parent
    // Portal can never render inside a tutor or student session.
    const hasAccess = await AuthService.verifyRoleAccess([UserRole.PARENT]);
    if (!hasAccess) {
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({ meta: [{ title: "Parent Portal | Anglian Learning" }] }),
  component: ParentDashboard,
});

/* ---------- Demo fixtures: only the session-less /demo/* showcase sees these.
   A real parent session below this block renders live data exclusively. ---- */

const DEMO_ANALYTICS_ROWS = [
  {
    subject: "biology",
    mcqAttempts: 12,
    mcqAverage: 88,
    hwGraded: 6,
    hwAverage: 84,
    predictedGrade: 8,
  },
  {
    subject: "chemistry",
    mcqAttempts: 10,
    mcqAverage: 79,
    hwGraded: 5,
    hwAverage: 76,
    predictedGrade: 7,
  },
  {
    subject: "physics",
    mcqAttempts: 8,
    mcqAverage: 82,
    hwGraded: 4,
    hwAverage: 80,
    predictedGrade: 7,
  },
];

const DEMO_TRENDS: WeeklyTrendPoint[] = [
  { biology: 72, chemistry: 68, physics: 60 },
  { biology: 78, chemistry: 70, physics: 62 },
  { biology: 80, chemistry: 72, physics: 58 },
  { biology: 85, chemistry: 74, physics: 60 },
  { biology: 84, chemistry: 76, physics: 62 },
  { biology: 88, chemistry: 78, physics: 65 },
].map((averages, i) => ({
  weekStart: `demo-${i}`,
  label: `Wk ${i + 1}`,
  averages,
}));

const DEMO_ENGAGEMENT = {
  sessionsHeld: 16,
  sessionsAttended: 15,
  homeworkSet: 6,
  homeworkSubmitted: 6,
};

const DEMO_FEEDBACK = [
  {
    id: "demo-1",
    subject: "biology",
    homeworkTitle: "Respiration structures",
    feedback:
      "Alex did brilliantly with human respiration structures. Perfect recall on the circulatory cycles and metabolic calculations.",
    grade: "A",
    scorePct: 92,
    gradedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
  },
  {
    id: "demo-2",
    subject: "physics",
    homeworkTitle: "Electromagnetism quiz",
    feedback:
      "Electromagnetism showed high understanding (92%). Reacting extremely well to mock paper practice guides. Keep it up!",
    grade: "A",
    scorePct: 92,
    gradedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
  },
];

export function ParentDashboard() {
  const { email } = useRoles();
  const { displayName: profileName } = useEnrolments();
  const isDemo = isDemoMode();

  const [parentId, setParentId] = useState<string | null>(null);
  useEffect(() => {
    if (isDemo) return;
    supabase.auth.getUser().then(({ data }) => setParentId(data.user?.id ?? null));
  }, [isDemo]);

  // Which child is being viewed. Defaults to the first linked child; a parent
  // with several children gets a switcher.
  const { data: children = [], isLoading: childrenLoading } = useChildLinks(!isDemo);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const childId = isDemo ? null : (selectedChildId ?? children[0]?.student_id ?? null);
  const selectedChild = children.find((c) => c.student_id === childId) ?? null;
  const childName = isDemo
    ? "Alex"
    : selectedChild
      ? resolveDisplayName(selectedChild.display_name, selectedChild.email)
      : "your child";

  // Real data, all keyed by the selected child. Every hook no-ops in demo mode
  // (childId stays null there).
  const { data: childSubjects = [] } = useChildSubjects(childId);
  const { rows: realAnalytics } = useAnalytics(childId, childSubjects);
  const { data: realTrends = [] } = useChildTrends(childId);
  const { data: realEngagement } = useChildEngagement(childId, childSubjects);
  const { data: realFeedback = [] } = useChildFeedback(childId);

  const analytics = isDemo ? DEMO_ANALYTICS_ROWS : realAnalytics;
  const trends = isDemo ? DEMO_TRENDS : realTrends;
  const trendSubjects = isDemo ? ["biology", "chemistry", "physics"] : childSubjects;
  const engagement = isDemo ? DEMO_ENGAGEMENT : realEngagement;
  const feedback = isDemo ? DEMO_FEEDBACK : realFeedback;

  const displayEmailName = isDemo ? DEMO_PARENT_NAME : resolveDisplayName(profileName, email);
  const hasChild = isDemo || !!childId;

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
          {hasChild
            ? `Track ${childName}'s science progress, predicted grades, attendance, and tutor feedback all in one place.`
            : "Link to your child's account to see their progress, grades and tutor feedback here."}
        </p>

        {/* Child switcher — only when there's a choice to make. */}
        {!isDemo && children.length > 1 && (
          <div className="mt-5 flex flex-wrap gap-2 relative">
            {children.map((c) => (
              <button
                key={c.student_id}
                onClick={() => setSelectedChildId(c.student_id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                  c.student_id === childId
                    ? "bg-primary-foreground text-primary"
                    : "bg-white/10 text-primary-foreground border border-white/20 hover:bg-white/20"
                }`}
              >
                {resolveDisplayName(c.display_name, c.email)}
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasChild && !childrenLoading ? (
        <div className="rounded-2xl bg-card border border-border p-8 text-center">
          <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-display font-semibold mb-1">No linked children yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Ask your child to invite you from their{" "}
            <span className="font-semibold">Linked Parents</span> page (or accept their pending
            invite on yours). Their progress appears here the moment you're linked.
          </p>
          <Link
            to="/parents"
            className="inline-block mt-4 h-10 leading-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
          >
            Open Linked Parents
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <GradePredictorCard analytics={analytics} />
            <TrendsChart points={trends} subjects={trendSubjects} />
          </div>
          <div className="space-y-8">
            {engagement && <EngagementStats engagement={engagement} childName={childName} />}
            <FeedbackList items={feedback} />
          </div>
        </div>
      )}

      {/* Billing: pay for and manage each linked child's plan. Fixture-free,
          so the session-less demo skips it. */}
      {!isDemo && parentId && <ParentBillingSection parentId={parentId} />}

      {/* Portal Shortcut Tiles */}
      <div className="mt-12">
        <h3 className="font-display text-lg font-bold text-slate-900 mb-5">
          Quick Access Portal Links
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map((t) => (
            <Link
              key={t.to}
              // The content pages are the same for both personas and only the
              // student showcase mounts them, so the parent's links cross over
              // to /demo/student/*. Staying on /demo/parent/* would hit the auth
              // guard; a bare /curriculum would too.
              to={isDemo ? `/demo/student${t.to}` : t.to}
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
