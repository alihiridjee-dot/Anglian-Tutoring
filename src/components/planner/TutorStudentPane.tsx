import { ArrowLeft, CalendarDays, Map as MapIcon, SlidersHorizontal, History } from "lucide-react";
import { toast } from "sonner";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { RoadmapPanel } from "./RoadmapPanel";
import { CoveredLedger } from "./CoveredLedger";
import { TopicOrderEditor } from "./TopicOrderEditor";
import { TutorWeekTab } from "./TutorWeekTab";
import { SchedulingAttention } from "./TutorPlannerParts";
import { type TutorPlannerState, type TutorTab } from "./useTutorPlanner";

const TABS: { key: TutorTab; label: string; icon: typeof CalendarDays }[] = [
  { key: "week", label: "This week", icon: CalendarDays },
  { key: "plan", label: "Full plan", icon: MapIcon },
  { key: "topics", label: "Practice history", icon: History },
];

/**
 * One student, opened from the roster: their name and course up top, the
 * subject picked once, then the same three tabs the student sees — this week,
 * the road to the exams, and what they have practised — with the tutor's
 * controls on each.
 */
export function TutorStudentPane({ state }: { state: TutorPlannerState }) {
  const { student, ordered, active, activeSubject, setSubject, tab, setTab, selectStudent } = state;
  const {
    roadmap,
    course,
    reload,
    bumpRefresh,
    refreshToken,
    orderEditorOpen,
    setOrderEditorOpen,
  } = state;
  if (!student) return null;
  const name = student.name ?? "This student";

  return (
    <section className="rounded-2xl premium-card shadow-sm overflow-hidden" aria-label={name}>
      <div className="px-4 sm:px-5 pt-4 border-b border-border">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
          <button
            type="button"
            onClick={() => selectStudent(null)}
            className="lg:hidden inline-flex items-center gap-1 h-7 px-2 rounded-full bg-muted text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3 h-3" aria-hidden /> Students
          </button>
          <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight">{name}</h2>
          {student.level && (
            <span className="chip tint-slate text-[10px] uppercase tracking-wide">
              {student.level.replace("_", " ")}
            </span>
          )}
          {active && (
            <span className="text-xs text-muted-foreground">{active.board.toUpperCase()}</span>
          )}
        </div>
        {ordered.length > 1 && (
          <div className="flex items-center gap-1.5 mb-3" role="tablist" aria-label="Subject">
            {ordered.map((e) => (
              <button
                key={e.subject}
                type="button"
                role="tab"
                aria-selected={e.subject === activeSubject}
                onClick={() => setSubject(e.subject)}
                className={`h-8 px-3.5 rounded-full text-sm font-medium transition ${
                  e.subject === activeSubject
                    ? "btn-solid"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {subjectLabel(e.subject)}
              </button>
            ))}
          </div>
        )}
        <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="Planner sections">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 px-3.5 h-10 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden />
              {label}
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
          <div className="space-y-4">
            {roadmap?.focusLoad.overloaded && <SchedulingAttention roadmap={roadmap} />}
            {orderEditorOpen && roadmap ? (
              <TopicOrderEditor
                key={`${student.id}:${course.subject}`}
                data={roadmap}
                course={course}
                asTutor
                studentName={student.name}
                onCancel={() => setOrderEditorOpen(false)}
                onSaved={async () => {
                  await reload();
                  bumpRefresh();
                  toast.success(`Topic order saved for ${name}.`);
                  setOrderEditorOpen(false);
                }}
              />
            ) : (
              <>
                {roadmap && !roadmap.needsAck && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setOrderEditorOpen(true)}
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted"
                    >
                      <SlidersHorizontal className="w-4 h-4" aria-hidden /> Change topic order
                    </button>
                  </div>
                )}
                <RoadmapPanel
                  studentId={student.id}
                  enrolments={[active]}
                  level={student.level}
                  asTutor
                  studentName={student.name}
                  refreshToken={refreshToken}
                />
              </>
            )}
          </div>
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
