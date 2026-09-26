import { Sparkles } from "lucide-react";
import { hasPrediction, type SubjectAnalytics } from "@/lib/profile/analytics";
import { subjectLabel, subjectTint } from "@/lib/curriculum/subjectTheme";
import { levelLabel } from "@/lib/curriculum/courseSummary";
import { SectionHeading } from "@/components/Shared";

export interface SubjectGrades {
  subject: string;
  target_grade: string | null;
  current_grade: string | null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="numeral text-sm">{value}</dd>
    </div>
  );
}

/**
 * Predicted grades per subject, from real quiz and homework averages.
 * A subject shows a dash until it has enough scored work to predict from
 * (`hasPrediction`) — a baseless "Grade 1" would alarm a parent for no reason.
 *
 * The tutor's target and current grade for each subject sit alongside, when
 * they have recorded them, so the prediction reads against where the child is
 * meant to be heading.
 *
 * The 1–9 scale is GCSE and International GCSE only. An A-Level student is
 * graded A*–E, and there is no calibrated mapping to one yet, so their card
 * shows the averages without inventing a letter.
 */
export function GradePredictorCard({
  analytics,
  level,
  grades = [],
}: {
  analytics: SubjectAnalytics[];
  level: string | null;
  /** The tutor-recorded grades per subject, from the enrolments. */
  grades?: readonly SubjectGrades[];
}) {
  if (analytics.length === 0) return null;
  const gradesOneToNine = level !== "alevel";

  return (
    <div className="premium-card p-6">
      <SectionHeading
        title="Predicted grades"
        hint={[levelLabel(level), "From quizzes and marked homework"].filter(Boolean).join(" · ")}
      >
        <span className="chip tint-emerald">
          <Sparkles className="size-3.5" aria-hidden /> Live data
        </span>
      </SectionHeading>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {analytics.map((row) => {
          const hasData = row.mcqAttempts + row.hwGraded > 0;
          const { target_grade: target, current_grade: current } =
            grades.find((g) => g.subject === row.subject) ?? {};
          return (
            <div
              key={row.subject}
              className={`pop-card pop-card-banded p-5 ${subjectTint(row.subject)}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="chip uppercase">{subjectLabel(row.subject)}</span>
                {target && <span className="chip chip-solid">Target {target}</span>}
              </div>

              {hasData ? (
                <>
                  {gradesOneToNine &&
                    (hasPrediction(row) ? (
                      <p className="numeral mt-4 text-4xl text-[color:var(--tint)]">
                        Grade {row.predictedGrade}
                      </p>
                    ) : (
                      <p className="numeral text-muted-foreground mt-4 text-4xl">—</p>
                    ))}
                  <p className="text-muted-foreground mt-2 text-xs">
                    {row.mcqAttempts} quiz{row.mcqAttempts === 1 ? "" : "zes"} · {row.hwGraded}{" "}
                    marked homework{row.hwGraded === 1 ? "" : "s"}
                  </p>
                  <dl className="border-border mt-4 space-y-2 border-t pt-3 text-xs">
                    <Row
                      label="Quiz average"
                      value={row.mcqAttempts > 0 ? `${row.mcqAverage}%` : "—"}
                    />
                    <Row
                      label="Homework average"
                      value={row.hwGraded > 0 ? `${row.hwAverage}%` : "—"}
                    />
                    {current && <Row label="Current grade" value={current} />}
                  </dl>
                </>
              ) : (
                <>
                  <p className="numeral text-muted-foreground mt-4 text-4xl">—</p>
                  <p className="text-muted-foreground mt-2 text-xs">No marked work yet</p>
                  {current && (
                    <dl className="border-border mt-4 border-t pt-3 text-xs">
                      <Row label="Current grade" value={current} />
                    </dl>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
