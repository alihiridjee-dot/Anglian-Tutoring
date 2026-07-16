import { CalendarClock } from "lucide-react";
import { WeeklyFocusManager } from "./WeeklyFocusManager";
import { LiveForm } from "./LiveForm";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";

interface Props {
  userId: string;
  taxonomy: {
    subject: SubjectV;
    setSubject: (v: SubjectV) => void;
    board: BoardV;
    setBoard: (v: BoardV) => void;
    level: LevelV;
    setLevel: (v: LevelV) => void;
  };
}

/**
 * The tutor's weekly workspace: set the curriculum focus for this Mon–Sun week,
 * then schedule the live session it's built around. Both share one taxonomy, and
 * the live form links its spec points to whichever week the chosen date falls in
 * — so "This Week" and the live session always cover the same ground.
 *
 * Standalone, unlinked scheduling still lives on /live for one-off sessions.
 */
export function ThisWeekPanel({ userId, taxonomy }: Props) {
  return (
    <div className="space-y-8">
      <WeeklyFocusManager userId={userId} taxonomy={taxonomy} />

      <div className="max-w-2xl rounded-2xl bg-card border border-border p-6">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary shrink-0" />
          <h3 className="font-display text-lg font-semibold">Schedule this week's live session</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Pick a date and the session automatically links to the focus you set above for that week.
          Need a one-off session for another week?{" "}
          <span className="font-medium text-foreground">Use the Live Sessions page.</span>
        </p>
        <LiveForm userId={userId} taxonomy={taxonomy} linkToWeek />
      </div>
    </div>
  );
}
