import { CheckCircle2, Clock } from "lucide-react";
import type { ChildEngagement } from "@/hooks/data/useChildProgress";

function Bar({
  label,
  icon,
  done,
  total,
  barClass,
  valueClass,
  caption,
}: {
  label: string;
  icon: React.ReactNode;
  done: number;
  total: number;
  barClass: string;
  valueClass: string;
  caption: string;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between items-center text-xs font-semibold mb-2">
        <span className="text-slate-600 flex items-center gap-1.5">
          {icon} {label}
        </span>
        <span className={valueClass}>{total > 0 ? `${pct}%` : "—"}</span>
      </div>
      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
        <div className={`${barClass} h-full rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">{caption}</p>
    </div>
  );
}

/** Real attendance and homework-completion, from join records and submissions. */
export function EngagementStats({
  engagement,
  childName,
}: {
  engagement: ChildEngagement;
  childName: string;
}) {
  const { sessionsHeld, sessionsAttended, homeworkSet, homeworkSubmitted } = engagement;
  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <h3 className="font-display text-lg font-bold text-slate-900 mb-5">Engagement Stats</h3>
      <div className="space-y-5">
        <Bar
          label="Live Class Attendance"
          icon={<Clock className="w-4 h-4 text-slate-400" />}
          done={sessionsAttended}
          total={sessionsHeld}
          barClass="bg-primary"
          valueClass="text-slate-900"
          caption={
            sessionsHeld > 0
              ? `${childName} joined ${sessionsAttended} of ${sessionsHeld} live sessions.`
              : "No live sessions have run yet."
          }
        />
        <Bar
          label="Homework Submitted"
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          done={homeworkSubmitted}
          total={homeworkSet}
          barClass="bg-emerald-500"
          valueClass="text-emerald-600"
          caption={
            homeworkSet > 0
              ? `${homeworkSubmitted} of ${homeworkSet} set homeworks submitted.`
              : "No homework has been set yet."
          }
        />
      </div>
    </div>
  );
}
