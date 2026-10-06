import { Link } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";
import { isDemoMode } from "@/lib/auth/session";
import { useCourseSummary } from "@/hooks/data/useCourseSummary";
import { useActiveSubject } from "@/hooks/useActiveSubject";

/**
 * The one chip that states a student's course — "GCSE · Edexcel",
 * "Chemistry · Edexcel". Every surface that names a level, board or subject
 * draws this, so the student sees the same pill everywhere. Feed it from
 * `useCourseSummary` / `useEnrolments` (one cached profile query) rather than
 * fetching the course again. Empty parts are dropped; `tint` recolours it.
 */
export function CourseChip({
  parts,
  icon = false,
  tint = "tint-primary",
  className = "",
}: {
  parts: (string | null | undefined)[];
  icon?: boolean;
  tint?: string;
  className?: string;
}) {
  const shown = parts.filter(Boolean) as string[];
  if (shown.length === 0) return null;
  return (
    <span className={`chip ${tint} whitespace-nowrap ${className}`}>
      {icon && <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      <CourseParts parts={shown} />
    </span>
  );
}

function CourseParts({ parts }: { parts: string[] }) {
  return parts.map((p, i) => (
    <span key={i} className="inline-flex items-center gap-1.5">
      {i > 0 && <span aria-hidden>·</span>}
      {p}
    </span>
  ));
}

/**
 * The persistent "you are studying X" chip in the app header.
 *
 * Which spec a student is on decides every piece of content they're shown, and
 * until now the app never said it anywhere outside the onboarding step where it
 * was chosen — so a student on the wrong board could work through a term of the
 * wrong material without a single prompt to check. It links to Billing, which is
 * where the plan and its coverage can actually be changed.
 *
 * Renders nothing when there's nothing true to say (a tutor, a parent, or a
 * profile still loading) rather than a placeholder. The showcase is excluded
 * because it holds no session, so its Billing link would bounce to /auth.
 */
export function CourseBadge({ followsSlider = false }: { followsSlider?: boolean }) {
  const { headline, levelLabel, boardLabels, perSubject, mixedBoards, loading } =
    useCourseSummary();
  // Where the subject slider sits beside this chip, the chip names that
  // subject's board — a student sitting Biology with AQA and Physics with OCR
  // reads the board of what's on screen, not both. Elsewhere it names them all.
  const { subject } = useActiveSubject();
  const active = followsSlider ? perSubject.find((s) => s.subject === subject) : undefined;

  if (isDemoMode() || loading || !headline) return null;

  const title = mixedBoards
    ? perSubject.map((s) => `${s.subjectLabel}: ${s.boardLabel}`).join(" · ")
    : perSubject.map((s) => s.subjectLabel).join(", ");

  return (
    <Link
      to="/billing"
      title={title ? `${headline} — ${title}` : headline}
      // Off on a phone either way up: upright there's no room beside the title,
      // and sideways the header has to stay one row (see AppLayout).
      // Drawn as the subject slider is, track and raised pill, at its size, so
      // the two read as a pair in the header rather than a badge and a control.
      className="tab-row tint-primary hidden sm:inline-flex short:hidden transition hover:opacity-80"
    >
      <span className="tab-item relative">
        <span className="tab-pill absolute inset-0" aria-hidden />
        <span className="relative inline-flex items-center gap-1.5 font-bold text-[color:var(--tint)]">
          <GraduationCap className="size-4 shrink-0" aria-hidden />
          <CourseParts
            parts={
              [levelLabel, ...(active ? [active.boardLabel] : boardLabels)].filter(
                Boolean,
              ) as string[]
            }
          />
        </span>
      </span>
    </Link>
  );
}
