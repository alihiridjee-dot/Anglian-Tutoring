import { Link } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";
import { isDemoMode } from "@/lib/auth/session";
import { useCourseSummary } from "@/hooks/data/useCourseSummary";

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
export function CourseBadge() {
  const { headline, perSubject, mixedBoards, loading } = useCourseSummary();

  if (isDemoMode() || loading || !headline) return null;

  const title = mixedBoards
    ? perSubject.map((s) => `${s.subjectLabel}: ${s.boardLabel}`).join(" · ")
    : perSubject.map((s) => s.subjectLabel).join(", ");

  return (
    <Link
      to="/billing"
      title={title ? `${headline} — ${title}` : headline}
      className="hidden sm:inline-flex items-center gap-1.5 h-7 rounded-full border border-border bg-secondary/60 px-2.5 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
    >
      <GraduationCap className="h-3.5 w-3.5 shrink-0" />
      <span className="whitespace-nowrap">{headline}</span>
    </Link>
  );
}
