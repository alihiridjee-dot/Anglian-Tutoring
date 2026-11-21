import {
  ArrowRight,
  Ban,
  CalendarClock,
  CalendarOff,
  CalendarPlus,
  Flag,
  ListOrdered,
  Minus,
  Plus,
  Redo2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/Shared";
import type { PlanChange } from "@/lib/planner/planChangesDal";
import { shortDayLabel } from "@/lib/planner/week";
import { cn } from "@/lib/utils";
import { TINT_TEXT } from "./figures";

const KINDS: Record<PlanChange["kind"], { tint: string; icon: LucideIcon }> = {
  moved: { tint: "tint-primary", icon: ArrowRight },
  added: { tint: "tint-emerald", icon: Plus },
  restored: { tint: "tint-emerald", icon: Undo2 },
  unskipped: { tint: "tint-emerald", icon: Undo2 },
  carried: { tint: "tint-amber", icon: Redo2 },
  removed: { tint: "tint-rose", icon: Minus },
  skipped: { tint: "tint-rose", icon: Ban },
  "plan-started": { tint: "tint-primary", icon: Flag },
  "exam-date": { tint: "tint-accent", icon: CalendarClock },
  "topic-order": { tint: "tint-accent", icon: ListOrdered },
  break: { tint: "tint-slate", icon: CalendarPlus },
  "break-cancelled": { tint: "tint-slate", icon: CalendarOff },
  "break-ended": { tint: "tint-slate", icon: CalendarOff },
};

/**
 * What has been changed in a student's plan, newest first, a day at a time.
 * Each line is one sentence with the kind of change marked by its icon and
 * colour. From 21 Nov 2026 it is the database's own log of each change; before
 * that, what the older rows still show.
 */
export function ChangesPanel({
  changes,
}: {
  changes: { id: string; at: string; kind: PlanChange["kind"]; text: string }[];
}) {
  if (changes.length === 0) return <EmptyState compact title="No changes to this plan yet" />;
  const days: { day: string; rows: typeof changes }[] = [];
  for (const change of changes) {
    const day = shortDayLabel(new Date(change.at));
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(change);
    else days.push({ day, rows: [change] });
  }
  return (
    <ol className="space-y-4 text-sm">
      {days.map((d) => (
        <li key={d.day + d.rows[0].id}>
          <h3 className="text-base font-extrabold">{d.day}</h3>
          <ul className="mt-1 space-y-1.5">
            {d.rows.map((change) => {
              const { tint, icon: Icon } = KINDS[change.kind];
              return (
                <li key={change.id} className={cn(tint, "flex items-start gap-2")}>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", TINT_TEXT)} aria-hidden />
                  <span className="min-w-0 break-words">{change.text}</span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
