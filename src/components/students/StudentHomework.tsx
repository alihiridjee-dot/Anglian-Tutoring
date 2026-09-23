import { Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { EmptyState, ErrorNote, SectionHeading, Spinner, StatTile } from "@/components/Shared";
import { useStudentSubmissions } from "@/hooks/data/useStudents";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { formatDate, scoreTint } from "./studentPresentation";

/**
 * Every piece of homework this student has handed in, newest first, with the
 * mark it got and whether a tutor has looked at it yet. Marking itself stays in
 * the queue on the Tutor Studio; this is the student's side of that ledger.
 */
export function StudentHomework({ studentId }: { studentId: string }) {
  const q = useStudentSubmissions(studentId);

  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <Spinner label="Loading homework" className="py-12" />;

  const rows = q.data;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing handed in yet"
        body="Homework the student submits appears here with its mark."
        mascot="books"
      />
    );
  }

  const marked = rows.filter((r) => r.graded_at && r.score_pct != null);
  const average =
    marked.length > 0
      ? Math.round(marked.reduce((n, r) => n + (r.score_pct ?? 0), 0) / marked.length)
      : null;
  const awaiting = rows.filter((r) => !r.graded_at).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Handed in" value={String(rows.length)} tint="tint-primary" />
        <StatTile
          label="Average mark"
          value={average == null ? "—" : `${average}%`}
          hint={marked.length > 0 ? `across ${marked.length} marked` : undefined}
          tint={scoreTint(average)}
        />
        <StatTile
          label="Awaiting mark"
          value={String(awaiting)}
          icon={ClipboardCheck}
          tint={awaiting > 0 ? "tint-amber" : "tint-emerald"}
        />
      </div>

      <section className="premium-card overflow-hidden rounded-2xl">
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <SectionHeading title="Submissions">
            <Link
              to="/tutor"
              className="btn-soft inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold"
            >
              Open marking queue
            </Link>
          </SectionHeading>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-muted-foreground text-xs tracking-widest uppercase">
            <tr>
              <th className="px-5 py-3 text-left">Homework</th>
              <th className="hidden px-5 py-3 text-left sm:table-cell">Handed in</th>
              <th className="px-5 py-3 text-left">Mark</th>
              <th className="hidden px-5 py-3 text-left md:table-cell">Status</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((r) => {
              const subject = r.resource?.subject;
              return (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <Link
                      to="/homework/$homeworkId"
                      params={{ homeworkId: r.resource_id }}
                      className="font-semibold hover:underline"
                    >
                      {r.resource?.title ?? "Homework"}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {subject && (
                        <span
                          className={`chip text-[10px] ${SUBJECT_TINT[subject] ?? "tint-slate"}`}
                        >
                          {subjectLabel(subject)}
                        </span>
                      )}
                      {r.resource?.origin === "generated" && (
                        <span className="chip tint-slate text-[10px]">Practice</span>
                      )}
                    </div>
                  </td>
                  <td className="text-muted-foreground hidden px-5 py-3 text-xs sm:table-cell">
                    {formatDate(r.submitted_at)}
                  </td>
                  <td className="px-5 py-3">
                    {r.graded_at && r.score_pct != null ? (
                      <span
                        className={`numeral text-lg text-[color:var(--tint)] ${scoreTint(r.score_pct)}`}
                      >
                        {Math.round(r.score_pct)}%
                        {r.grade && (
                          <span className="text-muted-foreground ml-1.5 text-xs">{r.grade}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="hidden px-5 py-3 md:table-cell">
                    {r.graded_at ? (
                      <span className="chip tint-emerald text-[10px]">
                        Marked {formatDate(r.graded_at)}
                      </span>
                    ) : r.release_at ? (
                      <span className="chip tint-amber text-[10px]">
                        Publishes {formatDate(r.release_at)}
                      </span>
                    ) : (
                      <span className="chip tint-slate text-[10px]">Awaiting mark</span>
                    )}
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
