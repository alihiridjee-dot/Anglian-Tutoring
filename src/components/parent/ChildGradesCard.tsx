import type { SubjectAnalytics } from "@/lib/profile/analytics";
import type { LevelV } from "@/lib/curriculum/taxonomy";
import { subjectLabel, subjectTint } from "@/lib/curriculum/subjectTheme";
import { SectionHeading } from "@/components/Shared";
import { GradeRings } from "@/components/homework/PredictedGradeCard";
import type { SubjectGrades } from "@/components/parent/GradePredictorCard";

/**
 * The child's grades on the Parent Portal: in each subject, the target beside
 * the grade their marked work says they are heading for, drawn exactly as the
 * child's own Tasks & Grades page draws it, with "On target" or how many grades
 * are left. A parent and child see one picture of the same grades.
 *
 * The quiz and task averages behind the prediction stay with the tutor's
 * Performance tab (`GradePredictorCard`). The grade a tutor has recorded as the
 * child's current one stays here, as a chip under the rings.
 *
 * The panels sit in a centred row, so one, two or three subjects fill it
 * without leaving an empty column. The Portal gives the card the page's full
 * width, where three fit in a row from a 1152px window; below that the third
 * sits centred under the other two.
 */
export function ChildGradesCard({
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

  return (
    <div className="premium-card p-4 sm:p-6">
      <SectionHeading title="Predicted grades" />
      <div className="mt-5 flex flex-wrap justify-center gap-4">
        {analytics.map((row) => {
          const { target_grade: target, current_grade: current } =
            grades.find((g) => g.subject === row.subject) ?? {};
          return (
            <div
              key={row.subject}
              // 19rem holds the pair side by side: an 88px ring, the
              // "Working towards" label (138px, measured) and the gap.
              className={`pop-card pop-card-banded flex w-full flex-col items-center gap-4 p-4 pt-5 sm:w-[19rem] ${subjectTint(row.subject)}`}
            >
              <span className="chip uppercase">{subjectLabel(row.subject)}</span>
              <GradeRings
                subject={row.subject}
                row={row}
                level={level as LevelV | null}
                targetGrade={target?.trim() || null}
                // Setting a missing target is the child's own, on their page.
                studentId={null}
                size={88}
              >
                {current?.trim() && <span className="chip">Current grade {current.trim()}</span>}
              </GradeRings>
            </div>
          );
        })}
      </div>
    </div>
  );
}
