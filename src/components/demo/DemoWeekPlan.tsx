import { useMemo, useState, type ReactNode } from "react";
import { CalendarRange, Sparkles } from "lucide-react";
import { ThisWeekPanel } from "@/components/planner/ThisWeekPanel";
import { DoNowPanel } from "@/components/planner/DoNowPanel";
import { SubjectToggle } from "@/components/Shared";
import { demoWeek } from "@/lib/demo/plannerDemo";
import { DEMO_ENROLMENTS } from "@/lib/demo/studentDemo";
import { SUBJECT_TINT } from "@/lib/subjectTheme";
import { mondayOf, weekRangeLabel } from "@/lib/week";
import type { SubjectV } from "@/lib/taxonomy";

/**
 * The showcase's "This week" — the planner a real student sees on their
 * dashboard, rendered from fixtures.
 *
 * It composes the planner's presentational panels directly instead of mounting
 * `WeeklyPlanPanel`, whose `useWeekPlan` saves plans and generates homework and
 * quizzes. A visitor must never reach that path, so it isn't on this page at all.
 *
 * Ticking a point off is local state only: it lasts until the page is left.
 *
 * @param after Rendered below the checklist for the same subject — the planner
 *   page hangs its road-to-the-exam view here, so one toggle drives both.
 */
export function DemoWeekPlan({ after }: { after?: (subject: SubjectV) => ReactNode } = {}) {
  const subjects = DEMO_ENROLMENTS.map((e) => e.subject as string);
  const [subject, setSubject] = useState<SubjectV>("biology");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  const week = useMemo(() => demoWeek(subject), [subject]);
  const points = useMemo(
    () =>
      week.points.map((p) =>
        p.spec_point_id in ticked
          ? { ...p, done_at: ticked[p.spec_point_id] ? new Date().toISOString() : null }
          : p,
      ),
    [week, ticked],
  );

  return (
    <div className={SUBJECT_TINT[subject]}>
      <div data-tour="week-plan" className="rounded-2xl premium-card p-4 sm:p-5 shadow-sm mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="icon-tile inline-flex w-9 h-9 shrink-0">
              <CalendarRange className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-lg font-extrabold sm:text-xl">This week</h2>
              <p className="text-xs text-muted-foreground">{weekRangeLabel(mondayOf())}</p>
            </div>
          </div>
          {/* On a phone the toggle scrolls sideways inside its own box rather
              than widening the page. */}
          <div className="scroll-slim max-w-full min-w-0 overflow-x-auto">
            <SubjectToggle
              subjects={subjects}
              value={subject}
              onChange={(s) => setSubject(s as SubjectV)}
            />
          </div>
        </div>

        {week.plan.ai_rationale && (
          <p className="mb-4 flex items-start gap-2 text-sm leading-relaxed">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-[color:var(--tint)]" aria-hidden />
            <span>{week.plan.ai_rationale}</span>
          </p>
        )}

        <ThisWeekPanel
          plan={week.plan}
          points={points}
          activity={week.activity}
          coverage={week.coverage}
          roadmap={null}
          loading={false}
          weekStart={week.plan.week_start}
          isPast={false}
          showCoverage
        />
      </div>

      <div data-tour="do-now">
        <DoNowPanel
          points={points}
          activity={week.activity}
          coverage={week.coverage}
          subject={subject}
          editable
          onToggle={(id, done) => setTicked((t) => ({ ...t, [id]: done }))}
        />
      </div>

      {after?.(subject)}
    </div>
  );
}
