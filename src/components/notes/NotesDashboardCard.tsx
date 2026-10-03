import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen } from "lucide-react";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useNoteConcepts } from "@/hooks/data/useNotes";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { isDemoStudent } from "@/lib/demo/studentDemo";

/** The dashboard's way into revision notes: how many topics are ready, per subject. */
export function NotesDashboardCard() {
  const { enrolledCourses, level } = useEnrolments();
  const { data } = useNoteConcepts(enrolledCourses);
  // The showcase has no session to read notes with, and /notes needs one.
  if (isDemoStudent() || enrolledCourses.length === 0) return null;

  const combined = level === "gcse_trilogy";
  const counts = enrolledCourses.map((s) => {
    const rows = (data ?? []).filter((c) => c.subject === s && !(combined && c.separate_only));
    return { subject: s, ready: rows.filter((c) => c.published).length, total: rows.length };
  });

  return (
    <section
      data-tour="revision-notes"
      className="premium-card mt-6 flex flex-wrap items-center gap-4 p-5"
    >
      <span className="icon-tile size-11 shrink-0">
        <BookOpen className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-extrabold">Revision notes</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {counts.map((c) => (
            <span key={c.subject} className={`chip ${SUBJECT_TINT[c.subject] ?? "tint-primary"}`}>
              {subjectLabel(c.subject)}: <span className="numeral">{c.ready}</span> topics ready
            </span>
          ))}
        </div>
      </div>
      <Link to="/notes" className="btn-solid inline-flex items-center gap-2 px-4 py-2 text-sm">
        Open notes <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
