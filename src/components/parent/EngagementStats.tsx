import { CheckCircle2, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ChildEngagement } from "@/hooks/data/useChildProgress";
import { Meter, SectionHeading } from "@/components/Shared";

/**
 * One measure: its label with the count beside it ("15 of 16"), then the bar.
 * The count used to be a grey sentence under the bar, saying it again.
 */
function Row({
  label,
  icon: Icon,
  done,
  total,
  tint,
}: {
  label: string;
  icon: LucideIcon;
  done: number;
  total: number;
  tint: string;
}) {
  return (
    <div className={tint}>
      <div className="mb-2 flex items-center gap-2.5">
        <span className="icon-tile size-7 shrink-0">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
        <span className="numeral shrink-0 text-sm">
          {done} of {total}
        </span>
      </div>
      <Meter value={(done / total) * 100} label size="sm" />
    </div>
  );
}

/**
 * Real attendance and homework-completion, from join records and submissions.
 * A measure with nothing behind it yet (no sessions held, no homework set) is
 * left out rather than shown as an empty bar.
 */
export function EngagementStats({ engagement }: { engagement: ChildEngagement }) {
  const { sessionsHeld, sessionsAttended, homeworkSet, homeworkSubmitted } = engagement;
  if (sessionsHeld === 0 && homeworkSet === 0) return null;

  return (
    <div className="premium-card p-4 sm:p-6">
      <SectionHeading title="Engagement" />
      <div className="mt-5 space-y-5">
        {sessionsHeld > 0 && (
          <Row
            label="Live class attendance"
            icon={Clock}
            done={sessionsAttended}
            total={sessionsHeld}
            tint="tint-primary"
          />
        )}
        {homeworkSet > 0 && (
          <Row
            label="Tasks handed in"
            icon={CheckCircle2}
            done={homeworkSubmitted}
            total={homeworkSet}
            tint="tint-emerald"
          />
        )}
      </div>
    </div>
  );
}
