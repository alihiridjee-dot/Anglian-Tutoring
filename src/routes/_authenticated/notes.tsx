import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BookOpen, ChevronRight, Search } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import {
  EmptyState,
  PageHeader,
  SectionHeading,
  Spinner,
  SubjectToggle,
} from "@/components/Shared";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useNoteConcepts, type NoteConceptRow } from "@/hooks/data/useNotes";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";

export const Route = createFileRoute("/_authenticated/notes")({
  beforeLoad: guardStudentSection,
  validateSearch: (search: Record<string, unknown>): { subject?: string } => ({
    subject: typeof search.subject === "string" ? search.subject : undefined,
  }),
  head: () => ({ meta: [{ title: "Revision Notes | Anglia Educate" }] }),
  component: Notes,
});

function Notes() {
  const { enrolledCourses, level, loading } = useEnrolments();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const subjects = enrolledCourses;
  const subject =
    search.subject && subjects.includes(search.subject) ? search.subject : subjects[0];
  const { data: concepts, isLoading, error } = useNoteConcepts(subjects);
  const [q, setQ] = useState("");

  // Combined-science students don't sit the separate-science-only topics.
  const combined = level === "gcse_trilogy";
  const chapters = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = (concepts ?? []).filter(
      (c) =>
        c.subject === subject &&
        !(combined && c.separate_only) &&
        (!term || `${c.title} ${c.scope} ${c.chapter}`.toLowerCase().includes(term)),
    );
    const byChapter = new Map<string, NoteConceptRow[]>();
    for (const c of rows) byChapter.set(c.chapter, [...(byChapter.get(c.chapter) ?? []), c]);
    return [...byChapter.entries()];
  }, [concepts, subject, combined, q]);

  const total = (concepts ?? []).filter(
    (c) => c.subject === subject && !(combined && c.separate_only),
  );
  const ready = total.filter((c) => c.published).length;

  return (
    <AppLayout title="Revision Notes">
      <div className={`${SUBJECT_TINT[subject ?? ""] ?? "tint-primary"} space-y-6`}>
        <PageHeader eyebrow="Revision notes" title="Notes" icon={BookOpen}>
          {subjects.length > 1 && subject ? (
            <SubjectToggle
              subjects={subjects}
              value={subject}
              onChange={(s) => navigate({ search: { subject: s } })}
            />
          ) : null}
        </PageHeader>

        {loading || isLoading ? (
          <Spinner label="Loading your notes" />
        ) : error ? (
          <EmptyState
            compact
            title="Notes didn't load"
            body="Check your connection and refresh the page."
          />
        ) : subjects.length === 0 || total.length === 0 ? (
          <EmptyState
            title="No notes here yet"
            body="Notes appear here for the subjects on your plan. If you think one is missing, message your tutor."
            mascot="books"
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="chip chip-solid">
                <span className="numeral">{ready}</span> of{" "}
                <span className="numeral">{total.length}</span> topics ready
              </span>
              <label className="premium-card planner-point-row flex min-w-0 flex-1 items-center gap-2 px-3 py-2 sm:max-w-sm">
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="sr-only">Search topics</span>
                <input
                  id="notes-search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search topics"
                  className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none"
                />
              </label>
            </div>

            {chapters.length === 0 ? (
              <EmptyState
                compact
                title="No topics match"
                body="Try a different word, or clear the search."
              />
            ) : (
              chapters.map(([chapter, rows]) => (
                <section key={chapter} className="space-y-3">
                  <SectionHeading title={chapter} />
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {rows.map((c) => (
                      <li key={c.id}>
                        {c.published ? (
                          <Link
                            to="/notes/$conceptId"
                            params={{ conceptId: c.id }}
                            className="premium-card premium-card-interactive flex h-full items-center gap-3 p-3"
                          >
                            <TopicText c={c} />
                            <ChevronRight
                              className="size-5 shrink-0 text-[var(--tint)]"
                              aria-hidden
                            />
                          </Link>
                        ) : (
                          <div className="premium-card planner-point-row flex h-full items-center gap-3 p-3 opacity-70">
                            <TopicText c={c} />
                            <span className="chip shrink-0">Coming soon</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

function TopicText({ c }: { c: NoteConceptRow }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="font-bold">{c.title}</p>
      {c.kind === "practical" || c.higher_only ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {c.kind === "practical" ? <span className="chip">Practical</span> : null}
          {c.higher_only ? <span className="chip">Higher</span> : null}
        </div>
      ) : null}
    </div>
  );
}
