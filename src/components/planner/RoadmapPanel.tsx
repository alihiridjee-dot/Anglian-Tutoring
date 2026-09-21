import { ErrorNote } from "@/components/Shared";
import { usePlannerRoadmap } from "@/hooks/data/usePlanner";
import { useQueryClient } from "@tanstack/react-query";
import { invalidatePlanner } from "@/lib/planner/queries";
import { Spinner } from "@/components/Shared";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { isTeachBand } from "@/lib/planner/pacing";
import { ProgramDAL } from "@/lib/planner/programDal";
import { type Enrolment } from "@/lib/profile/enrolment";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { currentWeekKey } from "@/lib/planner/week";
import { FocusKey } from "./FocusLane";
import { CatchUpPanel } from "./CatchUpPanel";
import { useRoadmapIndexes } from "./useRoadmapIndexes";
import { weekKeysBetween } from "./roadmapWeeks";
import { WeekTable } from "./RoadmapWeekTable";
import {
  OverloadedNotice,
  PlanShiftBanner,
  RoadmapFooter,
  RoadmapHeader,
} from "./RoadmapPanelParts";

/**
 * The year-long programme: every topic laid out from now to the exams, sized by
 * how big it is, so the student can see the whole road ahead. It re-flows as they
 * progress, and when a slip shifts future topics it asks them to acknowledge the
 * new plan rather than moving the goalposts silently. (Reused on the tutor's
 * planner to review a student's road.)
 */
export function RoadmapPanel({
  studentId,
  enrolments,
  level,
  refreshToken,
  asTutor = false,
  studentName,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  /** Bump to reload after an explicit schedule update. */
  refreshToken?: number;
  /** Tutor review mode: neutral copy, and the plan-shift is informational only
   *  (the acknowledgement is the student's own gesture — a tutor never consumes it). */
  asTutor?: boolean;
  /** The student whose road this is, for tutor-voiced copy. */
  studentName?: string | null;
}) {
  const ordered = useMemo(
    () => [
      ...enrolments.filter((e) => e.subject === "biology"),
      ...enrolments.filter((e) => e.subject !== "biology"),
    ],
    [enrolments],
  );
  const [activeSubject, setActiveSubject] = useState(ordered[0]?.subject ?? "biology");
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];

  // Reset to the first subject when the student changes (tutor view reuses this
  // component across students, so the previous pick must not carry over).
  useEffect(() => {
    setActiveSubject(ordered[0]?.subject ?? "biology");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const queryClient = useQueryClient();
  const roadmapQuery = usePlannerRoadmap(
    {
      studentId,
      subject: (active?.subject ?? "biology") as SubjectV,
      board: (active?.board ?? "aqa") as BoardV,
      level,
    },
    refreshToken,
    !!active,
  );
  const data = roadmapQuery.data ?? null;
  const loading = roadmapQuery.isLoading;
  const [acking, setAcking] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAllChanges, setShowAllChanges] = useState(false);
  // The programme's past is collapsed by default — the road ahead is what the
  // student came for — but it is *present*, which it was not before: the table
  // used to begin at the current week, so a topic taught earlier had no row at
  // all and could not be found, expanded, or practised from here.
  const [showHistory, setShowHistory] = useState(false);

  const toggle = (topicId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });

  const { progressByTopic, masteryByTopic, changeByTopic, owedByWeek } = useRoadmapIndexes(data);

  const load = async () => {
    await invalidatePlanner(queryClient, studentId);
  };

  const acknowledge = async () => {
    if (!data || !active) return;
    setAcking(true);
    try {
      await ProgramDAL.acknowledge({
        studentId,
        subject: active.subject as SubjectV,
        bands: data.bands,
        programStart: data.programStart,
        examDate: data.examDate,
      });
      toast.success("Plan updated — you're all set.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update — try again.");
    } finally {
      setAcking(false);
    }
  };

  if (!active) return null;
  if (roadmapQuery.error)
    return <ErrorNote error={roadmapQuery.error} onRetry={() => void roadmapQuery.refetch()} />;

  const covered = new Set(data?.coveredTopicIds ?? []);
  const spine = data?.bands.filter(isTeachBand) ?? [];
  // The plan they are still living by. While a reschedule is pending it drives
  // the Core column, so the proposal has something to be compared against.
  const baselineSpine = data?.baselineBands.filter(isTeachBand) ?? [];
  // The review column is open exactly while there is a shift to accept, and
  // closes the moment they accept it (needsAck goes false on reload).
  const reviewing = !!data?.needsAck && baselineSpine.length > 0;
  const topicIds = new Set(spine.map((b) => b.topicId));
  const total = topicIds.size;
  const doneCount = [...topicIds].filter((id) => covered.has(id)).length;
  // Weeks between the programme's start and today — the history the table can
  // show. Zero for a student in their first week, which is why the control is
  // conditional rather than always present.
  const earlierWeeks = data
    ? Math.max(0, weekKeysBetween(data.programStart, currentWeekKey()).length - 1)
    : 0;

  return (
    <div className="rounded-2xl premium-card p-4 sm:p-5 shadow-sm mt-6">
      <RoadmapHeader
        data={data}
        doneCount={doneCount}
        total={total}
        ordered={ordered}
        activeSubject={activeSubject}
        onSelectSubject={setActiveSubject}
        asTutor={asTutor}
        studentName={studentName}
      />

      {loading ? (
        <Spinner className="py-8" />
      ) : !data ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No curriculum found for this course yet.
        </p>
      ) : (
        <>
          {/* The ratings have asked for a year that doesn't fit in the year.
              For a tutor this is triage — one number that says which students
              need the conversation — so it names the cause rather than nagging
              about the workload, because the fix is a re-rate, not more hours. */}
          {data.focusLoad.overloaded && (
            <OverloadedNotice asTutor={asTutor} studentName={studentName} />
          )}

          {/* Plan-shift banner — a compact summary; the moved topics are flagged
              inline in the table below, so we don't repeat the full list here. */}
          {data.needsAck && (
            <PlanShiftBanner
              changes={data.changes}
              asTutor={asTutor}
              showAllChanges={showAllChanges}
              onToggleChanges={() => setShowAllChanges((v) => !v)}
              acking={acking}
              onAccept={acknowledge}
            />
          )}

          {/* One line for what the two columns are, and the key for the colours
              in the second. The longer version of both lives on hover — in the
              column's question mark, and on each swatch. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-2.5 text-[11px] text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">Core</span> is the course in order.{" "}
              <span className="font-semibold text-foreground">Focused</span> comes back until it
              sticks.
            </p>
            <FocusKey />
          </div>

          <CatchUpPanel
            studentId={studentId}
            subject={(active.subject ?? "biology") as SubjectV}
            board={(active.board ?? "aqa") as BoardV}
            level={level}
            weekStart={currentWeekKey()}
            backlog={data.backlogByTopic ?? []}
            asTutor={asTutor}
            onAdded={load}
          />

          <WeekTable
            spine={reviewing ? baselineSpine : spine}
            proposedSpine={reviewing ? spine : null}
            onAccept={asTutor ? null : acknowledge}
            accepting={acking}
            focusBands={data.bands.filter((b) => !isTeachBand(b))}
            programStart={data.programStart}
            showHistory={showHistory}
            owedByWeek={owedByWeek}
            catchUpSchedule={data.catchUpSchedule}
            examDate={data.examDate}
            covered={covered}
            progressByTopic={progressByTopic}
            masteryByTopic={masteryByTopic}
            changeByTopic={changeByTopic}
            expanded={expanded}
            onToggle={toggle}
          />

          {!!data.catchUpSchedule?.held.length && (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {data.catchUpSchedule.held.length} missed spec points cannot fit before the exam at
              the current catch-up pace.
            </p>
          )}

          <RoadmapFooter
            earlierWeeks={earlierWeeks}
            showHistory={showHistory}
            onToggleHistory={() => setShowHistory((v) => !v)}
          />
        </>
      )}
    </div>
  );
}
