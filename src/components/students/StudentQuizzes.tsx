import { Link } from "@tanstack/react-router";
import { EmptyState, ErrorNote, SectionHeading, Spinner, StatTile } from "@/components/Shared";
import { useStudentAttempts } from "@/hooks/data/useStudents";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { formatDateTime, scoreTint } from "./studentPresentation";

/** Every quiz attempt, newest first, with a running average up top. */
export function StudentQuizzes({ studentId }: { studentId: string }) {
  const q = useStudentAttempts(studentId);

  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Spinner label="Loading quizzes" className="py-12" />;

  const rows = q.data;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No quizzes attempted yet"
        body="Each attempt is listed here with its score."
        mascot="books"
      />
    );
  }

  const scored = rows.filter((r) => r.total > 0);
  const average =
    scored.length > 0
      ? Math.round(scored.reduce((n, r) => n + (r.score / r.total) * 100, 0) / scored.length)
      : null;
  const best = scored.reduce<number | null>((b, r) => {
    const pct = Math.round((r.score / r.total) * 100);
    return b == null || pct > b ? pct : b;
  }, null);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Attempts" value={String(rows.length)} tint="tint-primary" />
        <StatTile
          label="Average"
          value={average == null ? "—" : `${average}%`}
          tint={scoreTint(average)}
        />
        <StatTile label="Best" value={best == null ? "—" : `${best}%`} tint={scoreTint(best)} />
      </div>

      <section className="premium-card overflow-hidden rounded-2xl">
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <SectionHeading title="Attempts" />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-muted-foreground text-xs tracking-widest uppercase">
            <tr>
              <th className="px-5 py-3 text-left">Quiz</th>
              <th className="hidden px-5 py-3 text-left sm:table-cell">When</th>
              <th className="px-5 py-3 text-left">Score</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((r) => {
              const pct = r.total > 0 ? Math.round((r.score / r.total) * 100) : null;
              const subject = r.set?.subject;
              return (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <Link
                      to="/mcq/$setId"
                      params={{ setId: r.set_id }}
                      className="font-semibold hover:underline"
                    >
                      {r.set?.title ?? "Quiz"}
                    </Link>
                    {subject && (
                      <div className="mt-1">
                        <span
                          className={`chip text-[10px] ${SUBJECT_TINT[subject] ?? "tint-slate"}`}
                        >
                          {subjectLabel(subject)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="text-muted-foreground hidden px-5 py-3 text-xs sm:table-cell">
                    {formatDateTime(r.created_at)}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`numeral text-lg text-[color:var(--tint)] ${scoreTint(pct)}`}>
                      {pct == null ? "—" : `${pct}%`}
                    </span>
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {r.score}/{r.total}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
