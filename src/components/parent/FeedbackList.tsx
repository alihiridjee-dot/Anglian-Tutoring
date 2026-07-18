import { Award } from "lucide-react";
import type { FeedbackItem } from "@/hooks/data/useChildProgress";
import { SUBJECT_TEXT, subjectLabel } from "@/components/parent/subjectTheme";

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

/** Real tutor feedback, straight from marked homework submissions. */
export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-display text-lg font-bold text-slate-900">Tutor Feedback</h3>
        <Award className="w-5 h-5 text-amber-500" />
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No marked homework yet — tutor comments appear here as soon as work is graded.
        </p>
      ) : (
        <div className="space-y-4">
          {items.map((f) => (
            <div key={f.id} className="bg-slate-50 border border-slate-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-xs font-bold ${SUBJECT_TEXT[f.subject] ?? "text-slate-600"}`}
                >
                  {subjectLabel(f.subject)} — {f.homeworkTitle}
                </span>
                <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                  {timeAgo(f.gradedAt)}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed italic">"{f.feedback}"</p>
              {(f.grade || f.scorePct != null) && (
                <div className="mt-3 flex gap-3 items-center border-t border-slate-100 pt-3 text-[10px] text-slate-500">
                  {f.grade && <span>Grade: {f.grade}</span>}
                  {f.scorePct != null && <span>Score: {f.scorePct}%</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
