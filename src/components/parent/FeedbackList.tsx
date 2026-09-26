import { Award } from "lucide-react";
import type { FeedbackItem } from "@/hooks/data/useChildProgress";
import { subjectLabel, subjectTint } from "@/lib/curriculum/subjectTheme";
import { SectionHeading } from "@/components/Shared";

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1 week ago";
  if (weeks < 5) return `${weeks} weeks ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Real tutor feedback, straight from marked homework submissions. Only work
 * whose mark has been released — `graded_at` is stamped at release — so a
 * parent never reads a comment before their child can.
 */
export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="premium-card p-6">
      <SectionHeading title="Tutor feedback">
        <span className="icon-tile tint-amber size-8">
          <Award className="size-4" aria-hidden />
        </span>
      </SectionHeading>

      <ul className="mt-5 space-y-3">
        {items.map((f) => (
          <li
            key={f.id}
            className={`pop-card pop-card-flat rounded-xl p-4 ${subjectTint(f.subject)}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="chip">{subjectLabel(f.subject)}</span>
                <p className="mt-1.5 text-sm font-semibold">{f.homeworkTitle}</p>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs">{timeAgo(f.gradedAt)}</span>
            </div>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed italic">
              “{f.feedback}”
            </p>
            {(f.grade || f.scorePct != null) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {f.grade && <span className="chip">Grade {f.grade}</span>}
                {f.scorePct != null && <span className="chip">{f.scorePct}%</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
