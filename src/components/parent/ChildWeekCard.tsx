import { CheckCircle2, Circle } from "lucide-react";
import type { ChildWeekSubject } from "@/hooks/data/useChildProgress";
import { subjectLabel, subjectTint } from "@/lib/curriculum/subjectTheme";
import { mondayOf, weekRangeLabel } from "@/lib/planner/week";
import { Meter, SectionHeading } from "@/components/Shared";

/**
 * What the child is working on this week, read-only: each subject's planned
 * spec points with the ones they've ticked off, and the tutor's note on the
 * week when there is one. A parent can see the week, not change it — the plan
 * is the course's, and ticking is the child's.
 */
export function ChildWeekCard({ weeks }: { weeks: ChildWeekSubject[] }) {
  if (weeks.length === 0) return null;

  return (
    <div className="premium-card p-6">
      <SectionHeading title="This week" hint={weekRangeLabel(mondayOf())} />
      <div className="mt-5 space-y-6">
        {weeks.map((w) => {
          const done = w.points.filter((p) => p.done_at).length;
          return (
            <section key={w.subject} className={subjectTint(w.subject)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="chip uppercase">{subjectLabel(w.subject)}</span>
                <span className="text-muted-foreground text-xs">
                  <span className="numeral text-foreground text-sm">{done}</span> of{" "}
                  {w.points.length} done
                </span>
              </div>
              <Meter value={(done / w.points.length) * 100} size="sm" className="mt-3" />

              <ul className="mt-3 space-y-1.5">
                {w.points.map((p) => (
                  <li key={p.spec_point_id} className="flex items-start gap-2 text-sm">
                    {p.done_at ? (
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-[color:var(--tint)]"
                        aria-label="Done"
                      />
                    ) : (
                      <Circle
                        className="text-muted-foreground/60 mt-0.5 size-4 shrink-0"
                        aria-label="Not done yet"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="text-muted-foreground mr-1.5 text-xs font-semibold">
                        {p.code}
                      </span>
                      {p.title}
                    </span>
                  </li>
                ))}
              </ul>

              {w.tutorNote && (
                <figure className="pop-card pop-card-flat mt-4 rounded-xl p-4">
                  <figcaption className="eyebrow eyebrow-bare">Tutor&apos;s note</figcaption>
                  <blockquote className="mt-1.5 text-sm leading-relaxed whitespace-pre-line">
                    {w.tutorNote}
                  </blockquote>
                </figure>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
