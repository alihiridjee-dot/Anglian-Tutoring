import { useState } from "react";
import { toast } from "sonner";
import { History, Loader2, Plus } from "lucide-react";
import { WeeklyPlanDAL } from "@/lib/weeklyPlanDal";
import { type TopicBacklog } from "@/lib/planner/backlog";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { PLANNER_TIME_ZONE, weekKeyToDate } from "@/lib/week";

function fmtWeek(key: string): string {
  return weekKeyToDate(key).toLocaleDateString(undefined, {
    timeZone: PLANNER_TIME_ZONE,
    day: "numeric",
    month: "short",
  });
}

/**
 * What the programme has walked past — and the way back to it.
 *
 * A topic taught before the student engaged used to be doubly invisible: the
 * roadmap table began at the current week, so its rows did not exist, and both
 * planning lanes had moved on, so nothing would ever assign its points again
 * ([[backlog]]). The material was in the library and reachable by no route the
 * student had.
 *
 * The engine now trickles this back a fifth of a week at a time, which is the
 * right default and the wrong answer to "I want to do Topic 1 *now*". This is
 * that answer: the debt, named per topic and dated, with one control that puts
 * a whole topic's outstanding points into the current week.
 *
 * The addition is hand-picked (`student` / `tutor`), which is what it is — a
 * person overruling the pace — and hand-picked origins survive a re-cut. It is
 * exempt from the spine test for the same reason, though it would pass anyway:
 * every point here belongs to a topic that opened in the past.
 */
export function CatchUpPanel({
  studentId,
  subject,
  board,
  level,
  weekStart,
  backlog,
  asTutor,
  onAdded,
}: {
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  /** Monday of the week the work lands in — the current one. */
  weekStart: string;
  backlog: TopicBacklog[];
  asTutor: boolean;
  onAdded: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (backlog.length === 0) return null;

  const total = backlog.reduce((sum, t) => sum + t.points.length, 0);

  const add = async (topic: TopicBacklog) => {
    setBusy(topic.topicId);
    try {
      await WeeklyPlanDAL.addToWeek({
        studentId,
        subject,
        board,
        level,
        weekStart,
        specPointIds: topic.points.map((p) => p.specPointId),
        origin: asTutor ? "tutor" : "student",
      });
      toast.success(
        `Added ${topic.points.length} ${
          topic.points.length === 1 ? "point" : "points"
        } from ${topic.topicTitle} to this week.`,
      );
      await onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add those — try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3.5">
      <div className="flex items-start gap-2.5">
        <History className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {total} {total === 1 ? "spec point" : "spec points"} the plan has moved past
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {asTutor
              ? "These were scheduled in weeks that have gone by and were never covered. The programme brings a little back each week; add a whole topic to this week to go faster."
              : "These were set for weeks that have already gone by and never got covered. We bring a bit back each week — or add a whole topic to this week and take it on now."}
          </p>

          <ul className="mt-2.5 space-y-1.5">
            {backlog.map((topic) => (
              <li
                key={topic.topicId}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-background/60 border border-border px-2.5 py-1.5"
              >
                <span className="text-[13px] font-medium leading-snug flex-1 min-w-[8rem]">
                  {topic.topicTitle}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                  {topic.points.length} {topic.points.length === 1 ? "point" : "points"} · since{" "}
                  {fmtWeek(topic.since)}
                </span>
                <button
                  type="button"
                  onClick={() => add(topic)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-muted text-[10px] font-bold uppercase tracking-wide hover:bg-muted/70 disabled:opacity-50 shrink-0"
                >
                  {busy === topic.topicId ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                  Practise now
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
