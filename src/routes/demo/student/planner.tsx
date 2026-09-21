import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, CircleDot, Compass, Flag } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { DemoWeekPlan } from "@/components/demo/DemoWeekPlan";
import { Meter, SectionHeading } from "@/components/Shared";
import { DEMO_ROADMAP } from "@/lib/demo/plannerDemo";
import { addWeeks, mondayOf, PLANNER_TIME_ZONE } from "@/lib/week";
import type { SubjectV } from "@/lib/taxonomy";

// Showcase mount of the planner. Unlike the other /demo/student pages this is
// not the live page component: the live planner builds, saves and repairs plans
// and generates homework and quizzes as it goes, none of which may run without a
// student behind it. It composes the planner's own presentational panels over
// fixtures instead, so what a visitor sees is the real UI with nothing behind it.
export const Route = createFileRoute("/demo/student/planner")({
  head: () => ({ meta: [{ title: "My Planner | Anglia Educate" }] }),
  component: DemoPlannerPage,
});

/** Weeks from this Monday to the showcase's exams, fixed so the countdown reads sensibly. */
const WEEKS_TO_EXAMS = 34;

function DemoPlannerPage() {
  return (
    <AppLayout title="My Planner">
      {/* Intro ribbon — the same one the live planner opens with. */}
      <div className="rounded-2xl bg-gradient-to-br from-[var(--primary-deep)] to-[var(--primary)] text-primary-foreground px-5 py-4 sm:px-6 sm:py-5 mb-6 relative overflow-hidden shadow-sm">
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
            <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-white">
              Your plan to the exams
            </h2>
            <p className="text-xs sm:text-sm text-primary-foreground/80">
              What to work on this week, the road ahead, and how each topic is sticking.
            </p>
          </div>
        </div>
      </div>

      <DemoWeekPlan after={(subject) => <RoadToExam subject={subject} />} />
    </AppLayout>
  );
}

/**
 * The whole course laid out week by week, as the live planner's roadmap does:
 * what's done, what's on now, and what's still to come before the exam.
 */
function RoadToExam({ subject }: { subject: SubjectV }) {
  const topics = [...DEMO_ROADMAP[subject]].sort((a, b) => a.startsIn - b.startsIn);
  const monday = mondayOf();
  const fmt = (weeks: number) =>
    addWeeks(monday, weeks).toLocaleDateString("en-GB", {
      timeZone: PLANNER_TIME_ZONE,
      day: "numeric",
      month: "short",
    });

  return (
    <section data-tour="roadmap" className="premium-card rounded-2xl p-4 sm:p-5 mt-2">
      <SectionHeading
        title="Road to the exam"
        hint="Every topic in the course, scheduled so the whole spec is covered with time left to revise."
      >
        <span className="chip">
          <Flag className="size-3" aria-hidden />
          <span className="numeral">{WEEKS_TO_EXAMS}</span> weeks to go
        </span>
      </SectionHeading>

      <ol className="mt-4 space-y-2">
        {topics.map((t) => {
          const done = t.startsIn + t.weeks <= 0;
          const now = !done && t.startsIn <= 0;
          return (
            <li
              key={t.code}
              className={`premium-card planner-point-row flex flex-wrap items-center gap-3 px-3 py-2.5 ${
                now ? "surface-loud" : ""
              }`}
            >
              {done ? (
                <CheckCircle2 className="size-5 shrink-0 text-[color:var(--tint)]" aria-hidden />
              ) : (
                <CircleDot
                  className={`size-5 shrink-0 ${now ? "text-[color:var(--tint)]" : "text-muted-foreground/40"}`}
                  aria-hidden
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-snug">
                  <span className="text-muted-foreground mr-1.5 text-xs font-semibold">
                    {t.code}
                  </span>
                  {t.title}
                </p>
                <p className="text-muted-foreground text-xs">
                  {fmt(t.startsIn)} – {fmt(t.startsIn + t.weeks - 1)} · {t.weeks} weeks
                </p>
              </div>
              <span className={`chip shrink-0 ${now ? "chip-solid" : done ? "" : "tint-slate"}`}>
                {done ? "Covered" : now ? "This week" : "Coming up"}
              </span>
              {(done || now) && (
                <div className="w-full sm:w-40">
                  <Meter value={t.mastery} size="sm" />
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    <span className="numeral">{t.mastery}%</span> secure
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
