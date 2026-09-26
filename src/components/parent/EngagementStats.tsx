import { CheckCircle2, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ChildEngagement } from "@/hooks/data/useChildProgress";
import { Meter, SectionHeading } from "@/components/Shared";

function Row({
  label,
  icon: Icon,
  done,
  total,
  tint,
  caption,
}: {
  label: string;
  icon: LucideIcon;
  done: number;
  total: number;
  tint: string;
  caption: string;
}) {
  return (
    <div className={tint}>
      <div className="mb-2 flex items-center gap-2.5">
        <span className="icon-tile size-7 shrink-0">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <Meter value={(done / total) * 100} label size="sm" />
      <p className="text-muted-foreground mt-1.5 text-xs">{caption}</p>
    </div>
  );
}

/**
 * Real attendance and homework-completion, from join records and submissions.
 * A measure with nothing behind it yet (no sessions held, no homework set) is
 * left out rather than shown as an empty bar.
 */
export function EngagementStats({
  engagement,
  childName,
}: {
  engagement: ChildEngagement;
  childName: string;
}) {
  const { sessionsHeld, sessionsAttended, homeworkSet, homeworkSubmitted } = engagement;
  if (sessionsHeld === 0 && homeworkSet === 0) return null;

  return (
    <div className="premium-card p-6">
      <SectionHeading title="Engagement" />
      <div className="mt-5 space-y-5">
        {sessionsHeld > 0 && (
          <Row
            label="Live class attendance"
            icon={Clock}
            done={sessionsAttended}
            total={sessionsHeld}
            tint="tint-primary"
            caption={`${childName} joined ${sessionsAttended} of ${sessionsHeld} live sessions.`}
          />
        )}
        {homeworkSet > 0 && (
          <Row
            label="Homework handed in"
            icon={CheckCircle2}
            done={homeworkSubmitted}
            total={homeworkSet}
            tint="tint-emerald"
            caption={`${homeworkSubmitted} of ${homeworkSet} set homeworks handed in.`}
          />
        )}
      </div>
    </div>
  );
}
