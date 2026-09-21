import {
  Loader2,
  Map as MapIcon,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Scale,
  History,
} from "lucide-react";
import { type PacingChange } from "@/lib/planner/pacing";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type Enrolment } from "@/lib/profile/enrolment";
import { weekKeyToDate } from "@/lib/planner/week";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { fmtDate } from "./roadmapWeeks";

/** Whose programme this is, how far through it they are, and the subject switcher. */
export function RoadmapHeader({
  data,
  doneCount,
  total,
  ordered,
  activeSubject,
  onSelectSubject,
  asTutor,
  studentName,
}: {
  data: RoadmapResult | null;
  doneCount: number;
  total: number;
  ordered: Enrolment[];
  activeSubject: string;
  onSelectSubject: (subject: string) => void;
  asTutor: boolean;
  studentName?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
          <MapIcon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-display text-base font-bold tracking-tight">
            {asTutor
              ? `${studentName ? `${studentName}'s` : "Student"} programme to the exams`
              : "Your programme to the exams"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {data
              ? `${doneCount} of ${total} topics covered · exams from ${fmtDate(
                  weekKeyToDate(data.examDate),
                )} ${weekKeyToDate(data.examDate).getFullYear()}`
              : "How we'll cover the whole course before your exams."}
          </p>
        </div>
      </div>
      {ordered.length > 1 && (
        <div className="flex items-center gap-1.5">
          {ordered.map((e) => (
            <button
              key={e.subject}
              type="button"
              onClick={() => onSelectSubject(e.subject)}
              className={`h-8 px-3 rounded-lg text-sm font-medium transition ${
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
    </div>
  );
}

/** The plan asks for more weeks than there are before the exam. */
export function OverloadedNotice({
  asTutor,
  studentName,
}: {
  asTutor: boolean;
  studentName?: string | null;
}) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
      <Scale className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          {asTutor
            ? `This plan doesn't fit the time ${studentName ? `${studentName} has` : "left"}`
            : "This plan is asking a lot each week"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {asTutor
            ? "Some teaching topics or eligible reviews have no weekly slot before the exam. Review the exam date and remaining teaching runway."
            : "Some work has no weekly slot before the exam. Ask your tutor to review the plan."}
        </p>
      </div>
    </div>
  );
}

/** The spine has been re-flowed and is waiting for the student to accept it. */
export function PlanShiftBanner({
  changes,
  asTutor,
  showAllChanges,
  onToggleChanges,
  acking,
  onAccept,
}: {
  changes: PacingChange[];
  asTutor: boolean;
  showAllChanges: boolean;
  onToggleChanges: () => void;
  acking: boolean;
  onAccept: () => void;
}) {
  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            {asTutor ? "This student's plan has shifted" : "Your plan has shifted"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {changes.length} {changes.length === 1 ? "topic" : "topics"} rescheduled to stay on
            track for the exams —{" "}
            <span className="text-amber-700 dark:text-amber-300 font-medium">
              compare them in the Proposed column below
            </span>
            .{" "}
            {asTutor
              ? "It applies the next time they open their planner."
              : "Nothing changes until you accept it."}
          </p>

          <button
            type="button"
            onClick={onToggleChanges}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline"
            aria-expanded={showAllChanges}
          >
            {showAllChanges ? "Hide the dates" : "See what moved"}
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showAllChanges ? "rotate-180" : ""}`}
            />
          </button>
          {showAllChanges && (
            <ul className="mt-2 space-y-1">
              {changes.map((c) => (
                <li key={c.topicId} className="text-xs flex items-center flex-wrap gap-1.5">
                  <span className="font-medium">{c.title}</span>
                  {c.from ? (
                    <span className="text-muted-foreground">
                      wk of {fmtDate(weekKeyToDate(c.from))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">newly added</span>
                  )}
                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    wk of {fmtDate(weekKeyToDate(c.to))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!asTutor && (
            <button
              type="button"
              onClick={onAccept}
              disabled={acking}
              className="mt-2.5 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {acking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Accept the new plan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function RoadmapFooter({
  earlierWeeks,
  showHistory,
  onToggleHistory,
}: {
  earlierWeeks: number;
  showHistory: boolean;
  onToggleHistory: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] text-muted-foreground">
        Expand any topic to see its spec points. Catch-up estimates assume earlier weeks’ work is
        completed.
      </p>
      {earlierWeeks > 0 && (
        <button
          type="button"
          onClick={onToggleHistory}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
          aria-expanded={showHistory}
        >
          <History className="w-3.5 h-3.5" />
          {showHistory
            ? "Hide earlier weeks"
            : `Show ${earlierWeeks} earlier ${earlierWeeks === 1 ? "week" : "weeks"}`}
        </button>
      )}
    </div>
  );
}
