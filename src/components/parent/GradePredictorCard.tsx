import { Sparkles } from "lucide-react";
import type { SubjectAnalytics } from "@/hooks/data/useAnalytics";
import { SUBJECT_BADGE, subjectLabel } from "@/components/parent/subjectTheme";

/**
 * Predicted GCSE grades per subject, from real quiz and homework averages.
 * Subjects with no marked work yet say so instead of predicting Grade 1 from
 * nothing — a baseless "Grade 1" would alarm a parent for no reason.
 */
export function GradePredictorCard({ analytics }: { analytics: SubjectAnalytics[] }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-lg font-bold text-slate-900">
            GCSE Science Grade Predictor
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Grades (1-9) predicted from combined quiz results and marked homework.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full text-xs font-medium">
          <Sparkles className="w-3.5 h-3.5 text-emerald-500" /> Live data
        </span>
      </div>

      {analytics.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No enrolled subjects yet — predictions appear once your child is enrolled and has
          completed some work.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {analytics.map((row) => {
            const colors =
              SUBJECT_BADGE[row.subject] ?? "text-slate-600 bg-slate-50 border-slate-100";
            const hasData = row.mcqAttempts + row.hwGraded > 0;
            return (
              <div
                key={row.subject}
                className="border border-border/60 rounded-xl p-5 hover:border-primary/20 transition bg-linear-to-b from-white to-slate-50/50"
              >
                <div className="flex items-center justify-between mb-4">
                  <span
                    className={`text-xs font-bold uppercase px-2 py-0.5 rounded-md border ${colors}`}
                  >
                    {subjectLabel(row.subject)}
                  </span>
                </div>

                {hasData ? (
                  <>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-4xl font-display font-extrabold text-slate-900">
                        Grade {row.predictedGrade}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
                      Based on {row.mcqAttempts} quiz attempt{row.mcqAttempts === 1 ? "" : "s"} and{" "}
                      {row.hwGraded} marked homework{row.hwGraded === 1 ? "" : "s"}.
                    </p>
                    <div className="space-y-2 text-xs border-t border-slate-100 pt-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Quiz Average:</span>
                        <span className="font-semibold text-slate-800">
                          {row.mcqAttempts > 0 ? `${row.mcqAverage}%` : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Homework Average:</span>
                        <span className="font-semibold text-slate-800">
                          {row.hwGraded > 0 ? `${row.hwAverage}%` : "—"}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    No marked work yet — a prediction appears after the first quiz or graded
                    homework.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
