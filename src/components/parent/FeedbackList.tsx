import { Award } from "lucide-react";
import type { FeedbackItem } from "@/hooks/data/useChildProgress";
import { subjectLabel, subjectTint } from "@/lib/curriculum/subjectTheme";
import { SciText, SectionHeading } from "@/components/Shared";

/**
 * How long ago a mark came back. Under a day it counts hours: whole days alone
 * called last night's mark "today" the next morning. Older than a month it is
 * the date, written the UK way whatever the browser's language.
 */
function timeAgo(iso: string): string {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1 week ago";
  if (weeks < 5) return `${weeks} weeks ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Real tutor feedback, straight from marked homework submissions. Only work
 * whose mark has been released — `graded_at` is stamped at release — so a
 * parent never reads a comment before their child can.
 */
export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="premium-card p-4 sm:p-6">
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
                <p className="mt-1.5 text-sm font-semibold break-words">{f.homeworkTitle}</p>
              </div>
              <span className="chip shrink-0">{timeAgo(f.gradedAt)}</span>
            </div>
            {/* The tutor's words are the point of the card: normal text, not
                grey italics. */}
            <p className="mt-2 text-sm leading-relaxed">
              “<SciText text={f.feedback} />”
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
