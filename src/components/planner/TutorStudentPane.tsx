import { ArrowLeft, CalendarDays, Map as MapIcon, History } from "lucide-react";
import { SubjectToggle } from "@/components/Shared";
import { relativeWeekLabel } from "@/lib/planner/week";
import { CoveredLedger } from "./CoveredLedger";
import { TutorWeekTab } from "./TutorWeekTab";
import { TutorFullPlan } from "./fullPlan/TutorFullPlan";
import { type TutorPlannerState, type TutorTab } from "./useTutorPlanner";

const TABS: { key: TutorTab; label: string; icon: typeof CalendarDays }[] = [
  { key: "week", label: "This week", icon: CalendarDays },
  { key: "plan", label: "Full plan", icon: MapIcon },
  { key: "topics", label: "Practice history", icon: History },
];

/**
 * One student, opened from the roster: their name and course up top, the
 * subject picked once, then the same three tabs the student sees — the week,
 * the road to the exams, and what they have practised — with the tutor's
 * controls on each.
 *
 * This header is the only place the student is named. The tabs below it do
 * not repeat the name or the subject, which is most of what made the full plan
 * read as boxes inside boxes.
 */
export function TutorStudentPane({ state }: { state: TutorPlannerState }) {
  const { student, ordered, active, activeSubject, setSubject, tab, setTab, selectStudent } = state;
  const { weekStart, currentWeek } = state;
  if (!student) return null;
  const name = student.name ?? "This student";
  const courseLabel = [student.level?.replace(/_/g, " "), active?.board.toUpperCase()]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="rounded-2xl premium-card shadow-sm overflow-hidden" aria-label={name}>
      <div className="px-4 sm:px-5 pt-4 border-b border-border">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
          <button
            type="button"
            onClick={() => selectStudent(null)}
            className="lg:hidden btn-ghost inline-flex items-center gap-1 h-11 px-3 rounded-lg text-xs"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Students
          </button>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight">{name}</h2>
          {courseLabel && (
            <span className="chip tint-slate text-[11px] uppercase tracking-wide">
              {courseLabel}
            </span>
          )}
        </div>
        {ordered.length > 1 && (
          <div className="mb-3">
            <SubjectToggle
              subjects={ordered.map((e) => e.subject)}
              value={activeSubject}
              onChange={setSubject}
            />
          </div>
        )}
        <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="Planner sections">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 px-3.5 h-11 sm:h-10 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden />
              {/* The week tab names the week it shows, so moving the week in
                  the roster is visible here too. */}
              {key === "week" ? relativeWeekLabel(weekStart, currentWeek) : label}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-4 sm:p-5">
        {!active ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {name} has no subject enrolments yet.
          </p>
        ) : !student.level ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {name} has no exam level set — set it on their profile before planning.
          </p>
        ) : tab === "week" ? (
          <TutorWeekTab state={state} />
        ) : tab === "plan" ? (
          <TutorFullPlan key={`${student.id}:${active.subject}`} state={state} />
        ) : (
          <CoveredLedger
            studentId={student.id}
            enrolments={student.enrolments}
            level={student.level}
            subject={active.subject}
          />
        )}
      </div>
    </section>
  );
}
