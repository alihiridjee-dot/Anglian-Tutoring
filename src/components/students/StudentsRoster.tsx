import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronRight, Search, Users } from "lucide-react";
import { EmptyState, ErrorNote, Spinner } from "@/components/Shared";
import { inputCls } from "@/components/tutor/Field";
import {
  useRosterEnrolments,
  useRosterSubscriptions,
  useStudentDirectory,
} from "@/hooks/data/useStudents";
import { resolveDisplayName } from "@/lib/profile/displayName";
import { levelLabel, subjectLabel } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { PLAN_STATE_LABEL, PLAN_STATE_TINT, planStateOf, timeAgo } from "./studentPresentation";

/**
 * Every student on the platform, one row each, searchable by name or email.
 *
 * Three reads — the directory RPC, every enrolment, every subscription — joined
 * here rather than per row, so the table costs the same for seven students as
 * for seven hundred.
 */
export function StudentsRoster() {
  const directory = useStudentDirectory();
  const enrolments = useRosterEnrolments();
  const subscriptions = useRosterSubscriptions();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = directory.data ?? [];
    if (!q) return all;
    return all.filter(
      (s) => (s.display_name ?? "").toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
    );
  }, [directory.data, query]);

  if (directory.error) {
    return <ErrorNote error={directory.error} onRetry={() => void directory.refetch()} />;
  }
  if (directory.isPending) return <Spinner label="Loading students" className="py-12" />;

  if ((directory.data ?? []).length === 0) {
    return (
      <EmptyState
        title="No students yet"
        body="Students appear here as soon as they finish signing up."
        mascot="books"
      />
    );
  }

  return (
    <div className="space-y-4">
      <label className="relative block max-w-sm">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search students"
          className={`${inputCls} pl-9`}
        />
      </label>

      <div className="premium-card overflow-hidden rounded-2xl">
        <div className="scroll-slim overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground text-xs tracking-widest uppercase">
              <tr>
                <th className="px-4 sm:px-5 py-3 text-left">Student</th>
                <th className="hidden px-4 sm:px-5 py-3 text-left md:table-cell">Course</th>
                <th className="px-4 sm:px-5 py-3 text-left">Plan</th>
                <th className="hidden px-4 sm:px-5 py-3 text-left lg:table-cell">Last active</th>
                <th className="w-10 px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted-foreground px-5 py-10 text-center">
                    <Users className="mx-auto mb-2 size-6 opacity-50" aria-hidden />
                    No student matches “{query.trim()}”.
                  </td>
                </tr>
              ) : (
                rows.map((s) => {
                  const subs = enrolments.data?.[s.id] ?? [];
                  const plan = planStateOf(subscriptions.data?.[s.id]);
                  const name = resolveDisplayName(s.display_name, s.email);
                  return (
                    <tr key={s.id} className="hover:bg-muted/30 group relative">
                      <td className="px-4 sm:px-5 py-3">
                        <Link
                          to="/students/$studentId"
                          params={{ studentId: s.id }}
                          className="font-semibold after:absolute after:inset-0 after:content-['']"
                        >
                          {name}
                        </Link>
                        <p className="text-muted-foreground mt-0.5 text-xs wrap-anywhere">
                          {s.email}
                        </p>
                      </td>
                      <td className="hidden px-4 sm:px-5 py-3 md:table-cell">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {s.level && (
                            <span className="chip tint-primary text-[10px]">
                              {levelLabel(s.level)}
                            </span>
                          )}
                          {subs.map((e) => (
                            <span
                              key={e.id}
                              className={`chip text-[10px] ${SUBJECT_TINT[e.subject] ?? "tint-slate"}`}
                            >
                              {subjectLabel(e.subject)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 sm:px-5 py-3">
                        <span className={`chip text-[10px] ${PLAN_STATE_TINT[plan]}`}>
                          {PLAN_STATE_LABEL[plan]}
                        </span>
                      </td>
                      <td className="text-muted-foreground hidden px-4 sm:px-5 py-3 text-xs lg:table-cell">
                        {timeAgo(s.last_sign_in_at)}
                      </td>
                      <td className="px-2 py-3">
                        <ChevronRight
                          className="text-muted-foreground size-4 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100"
                          aria-hidden
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
