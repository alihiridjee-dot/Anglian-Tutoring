import { Link, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ClipboardList,
  Compass,
  CreditCard,
  IdCard,
  ListChecks,
  MessagesSquare,
  StickyNote,
  TrendingUp,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { EmptyState, ErrorNote, Spinner } from "@/components/Shared";
import { useStudentDirectory, useStudentRecord } from "@/hooks/data/useStudents";
import { resolveDisplayName } from "@/lib/profile/displayName";
import { levelLabel, subjectLabel } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { cn } from "@/lib/utils";
import { StudentHeader } from "./StudentHeader";
import { StudentOverview } from "./StudentOverview";
import { StudentHomework } from "./StudentHomework";
import { StudentQuizzes } from "./StudentQuizzes";
import { StudentBilling } from "./StudentBilling";
import { StudentMessages } from "./StudentMessages";
import { StudentNotes } from "./StudentNotes";
import { PLAN_STATE_LABEL, PLAN_STATE_TINT, planStateOf } from "./studentPresentation";
import type { StudentTab } from "./studentTabs";

// Recharts comes with the performance tab only, for the same reason the parent
// portal loads it on demand: nobody else on the site should pay for it.
const StudentPerformance = lazy(() =>
  import("./StudentPerformance").then((m) => ({ default: m.StudentPerformance })),
);

const NAV: { tab: StudentTab; label: string; icon: LucideIcon }[] = [
  { tab: "overview", label: "Overview", icon: IdCard },
  { tab: "performance", label: "Performance", icon: TrendingUp },
  { tab: "homework", label: "Homework", icon: ClipboardList },
  { tab: "quizzes", label: "Quizzes", icon: ListChecks },
  { tab: "billing", label: "Billing", icon: CreditCard },
  { tab: "messages", label: "Messages", icon: MessagesSquare },
  { tab: "notes", label: "Notes", icon: StickyNote },
];

/**
 * One student's record: a header naming them, a side navigation of the areas
 * a tutor manages, and the active area. The record itself is fetched once
 * (`useStudentRecord`) and handed to every tab; tabs that need more read it
 * under the same key.
 */
export function StudentRecordPage({ studentId, tab }: { studentId: string; tab: StudentTab }) {
  const record = useStudentRecord(studentId);
  // The directory carries the email; the profile row does not. Usually cached
  // from the roster the tutor came through.
  const directory = useStudentDirectory();
  const navigate = useNavigate();
  const setTab = (next: StudentTab) =>
    void navigate({
      to: "/students/$studentId",
      params: { studentId },
      search: { tab: next },
      replace: true,
    });

  const entry = directory.data?.find((s) => s.id === studentId) ?? null;
  const email = entry?.email ?? null;

  if (record.error) {
    return (
      <AppLayout title="Student">
        <ErrorNote error={record.error} onRetry={() => void record.refetch()} />
      </AppLayout>
    );
  }
  if (record.isPending) {
    return (
      <AppLayout title="Student">
        <Spinner label="Loading student" className="py-12" />
      </AppLayout>
    );
  }
  if (!record.data) {
    return (
      <AppLayout title="Student">
        <EmptyState
          title="No such student"
          body="This id doesn't belong to a student account."
          action={{ to: "/students", label: "Back to students" }}
        />
      </AppLayout>
    );
  }

  const data = record.data;
  const name = resolveDisplayName(data.profile.display_name, email);
  const plan = planStateOf(data.subscription);

  return (
    <AppLayout title={name}>
      <Link
        to="/students"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm font-semibold"
      >
        <ArrowLeft className="size-4" aria-hidden /> All students
      </Link>

      <StudentHeader name={name} email={email} record={data}>
        {data.profile.level && (
          <span className="chip tint-primary text-[10px]">{levelLabel(data.profile.level)}</span>
        )}
        {data.enrolments.map((e) => (
          <span
            key={e.id}
            className={`chip text-[10px] ${SUBJECT_TINT[e.subject] ?? "tint-slate"}`}
          >
            {subjectLabel(e.subject)}
          </span>
        ))}
        <span className={`chip text-[10px] ${PLAN_STATE_TINT[plan]}`}>
          {PLAN_STATE_LABEL[plan]}
        </span>
      </StudentHeader>

      <div className="mt-6 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Student record sections" className="lg:sticky lg:top-6 lg:self-start">
          <ul className="tab-row lg:flex-col lg:items-stretch">
            {NAV.map(({ tab: t, label, icon: Icon }) => (
              <li key={t} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setTab(t)}
                  aria-current={t === tab ? "page" : undefined}
                  data-active={t === tab}
                  className={cn("tab-item w-full justify-start gap-2", t === tab && "tint-primary")}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </button>
              </li>
            ))}
            <li className="shrink-0 lg:mt-2">
              <Link
                to="/planner"
                search={{ student: studentId }}
                className="tab-item w-full justify-start gap-2"
              >
                <Compass className="size-4 shrink-0" aria-hidden />
                Planner
              </Link>
            </li>
          </ul>
        </nav>

        <div className="min-w-0">
          {tab === "overview" && <StudentOverview record={data} email={email} />}
          {tab === "performance" && (
            <Suspense fallback={<Spinner label="Loading performance" className="py-12" />}>
              <StudentPerformance record={data} name={name} />
            </Suspense>
          )}
          {tab === "homework" && <StudentHomework studentId={studentId} />}
          {tab === "quizzes" && <StudentQuizzes studentId={studentId} />}
          {tab === "billing" && <StudentBilling record={data} name={name} />}
          {tab === "messages" && <StudentMessages studentId={studentId} />}
          {tab === "notes" && <StudentNotes studentId={studentId} />}
        </div>
      </div>
    </AppLayout>
  );
}
