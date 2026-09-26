import type { UpcomingSession } from "@/hooks/data/useChildProgress";
import { subjectLabel, subjectTint } from "@/lib/curriculum/subjectTheme";
import { formatWhen } from "@/lib/live/liveSessions";
import { SectionHeading } from "@/components/Shared";

/**
 * The child's next live lessons: when, and what. There is deliberately no join
 * link — the lesson is the child's to attend, and a parent's copy of the link
 * would put an adult in a room of other people's children.
 */
export function UpcomingSessions({ sessions }: { sessions: UpcomingSession[] }) {
  if (sessions.length === 0) return null;

  return (
    <div className="premium-card p-6">
      <SectionHeading title="Upcoming sessions" />
      <ul className="mt-5 space-y-3">
        {sessions.map((s) => (
          <li
            key={s.id}
            className={`pop-card pop-card-flat rounded-xl p-4 ${subjectTint(s.subject)}`}
          >
            <span className="chip">{subjectLabel(s.subject)}</span>
            <p className="mt-1.5 text-sm font-semibold">{s.title}</p>
            <p className="numeral mt-1 text-sm text-[color:var(--tint)]">
              {formatWhen(new Date(s.starts_at).getTime())}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
