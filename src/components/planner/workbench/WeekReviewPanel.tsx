import { useId } from "react";
import { ClipboardCheck } from "lucide-react";
import { SciAnswerBox } from "@/components/homework/SciAnswerBox";
import { ErrorNote, SciText, Spinner } from "@/components/Shared";
import { type BoardV, type LevelV, type SubjectV } from "@/lib/curriculum/taxonomy";
import {
  type Lane,
  type PointCoverage,
  type Verdict,
  type WeekSummary,
} from "@/lib/planner/coverage";
import { type PlanPoint, type WeeklyPlan } from "@/lib/planner/weeklyPlanDal";
import { cn } from "@/lib/utils";
import { useTutorTake } from "../useTutorTake";
import { useWeekVerdicts, useWeeklyCheckin } from "../useWeekReview";
import { type Activity } from "../useWeekPlan";
import { QUIET, SOLID, Tally, TINT_TEXT } from "./figures";

/** The week's lanes as the plan grid names and colours them. */
const LANES: Record<Lane, { name: string; tint: string }> = {
  core: { name: "Course", tint: "tint-primary" },
  focus: { name: "Revision", tint: "tint-rose" },
  tutor: { name: "Set by you", tint: "tint-accent" },
  yours: { name: "Added by the student", tint: "tint-slate" },
};
const VERDICT: Record<Verdict, string> = {
  move_on: "On track",
  almost: "Mostly covered",
  keep_going: "Needs work",
  no_signal: "Nothing set",
};
/** A lane's counts, in the order a tutor reads them: what went well first. */
const COUNTS: { key: keyof WeekSummary; one: string; tint: string }[] = [
  { key: "strong", one: "nailed it", tint: "tint-emerald" },
  { key: "practised", one: "practised", tint: "tint-primary" },
  { key: "weak", one: "shaky", tint: "tint-amber" },
  { key: "notDone", one: "not done", tint: "tint-slate" },
  { key: "notSet", one: "nothing set", tint: "tint-slate" },
];

/** What the review draws, with nothing fetched: the preview page draws it over made-up data. */
export interface WeekReviewViewProps {
  firstName: string;
  lanes: { lane: Lane; summary: WeekSummary }[];
  /** The student's check-in in words, when they sent one. */
  checkin: { felt: string; said: string } | null;
  note:
    | { state: "loading" }
    | { state: "error"; error: unknown; retry: () => void }
    | {
        state: "ready";
        value: string;
        onChange: (value: string) => void;
        saving: boolean;
        drafting: boolean;
        onSave: () => void;
        onDraft: () => void;
      };
}

/**
 * One week, reviewed by the tutor, in three plain parts: how each lane went (a
 * verdict in two words and its counts), what the student said in their
 * check-in, and the tutor's note back, which the student reads on their planner.
 *
 * It is the tutor's own review, not the student's panel shown read-only: no
 * card per lane, no bar, no explaining sentences.
 */
export function WeekReviewView({ firstName, lanes, checkin, note }: WeekReviewViewProps) {
  const noteId = useId();
  return (
    <div className="space-y-5 text-sm">
      {lanes.length > 0 && (
        <section aria-label="How it went">
          <h3 className="text-base font-extrabold">How it went</h3>
          <ul className="mt-1.5 space-y-2">
            {lanes.map((g) => (
              <li
                key={g.lane}
                className={cn(
                  LANES[g.lane].tint,
                  "flex flex-wrap items-center gap-x-4 gap-y-1 border-l-4 border-[var(--tint)] py-1 pl-3",
                )}
              >
                <b className={cn("sm:w-44", TINT_TEXT)}>{LANES[g.lane].name}</b>
                <b className="sm:w-36">{VERDICT[g.summary.verdict]}</b>
                {COUNTS.map((c) => {
                  const n = g.summary[c.key] as number;
                  return n > 0 ? <Tally key={c.key} n={n} word={c.one} tint={c.tint} /> : null;
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {checkin && (
        <section aria-label="Check-in" className="tint-accent border-l-4 border-[var(--tint)] pl-3">
          <b className={cn("inline-flex items-center gap-1.5", TINT_TEXT)}>
            <ClipboardCheck className="size-4" aria-hidden />
            {firstName}'s check-in
          </b>
          <p>
            {checkin.felt}
            {checkin.said && (
              <>
                {" "}
                “<SciText text={checkin.said} />”
              </>
            )}
          </p>
        </section>
      )}

      <section aria-label="Your note">
        <label htmlFor={noteId} className="font-display text-base font-extrabold">
          Your note to {firstName}
        </label>
        {note.state === "error" ? (
          <div className="mt-1.5">
            <ErrorNote error={note.error} onRetry={note.retry} />
          </div>
        ) : note.state === "loading" ? (
          <Spinner className="py-6" />
        ) : (
          <>
            <SciAnswerBox
              id={noteId}
              value={note.value}
              onValueChange={note.onChange}
              rows={4}
              placeholder={`${firstName} reads this on their planner`}
              className="premium-input mt-1.5 w-full resize-none rounded-lg px-3 py-2 text-sm"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <button
                type="button"
                className={SOLID}
                disabled={note.saving || note.drafting}
                onClick={note.onSave}
              >
                {note.saving ? "Saving" : `Save and share with ${firstName}`}
              </button>
              <button
                type="button"
                className={QUIET}
                disabled={note.saving || note.drafting}
                onClick={note.onDraft}
              >
                {note.drafting ? "Drafting" : "Draft from this week's marks"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * The review of one saved week, read and saved through the planner's own
 * hooks: the lanes' verdicts, the student's check-in and the tutor's note.
 *
 * Lining points up for next week and carrying unfinished ones forward are done
 * in the plan grid (Add on a week; tick and Move), so they are not repeated
 * here. Points already lined up in a saved note are kept when it is saved again.
 */
export function WeekReviewPanel({
  studentId,
  firstName,
  plan,
  points,
  coverage,
  activity,
  subject,
  board,
  level,
  weekStart,
  onChanged,
}: {
  studentId: string;
  firstName: string;
  plan: WeeklyPlan;
  points: PlanPoint[];
  coverage: Map<string, PointCoverage>;
  activity: Activity;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  weekStart: string;
  onChanged: () => void;
}) {
  const { lanes, metrics } = useWeekVerdicts({ points, coverage, activity, weekStart });
  const checkin = useWeeklyCheckin({ studentId, plan, points, coverage, activity });
  const take = useTutorTake({
    studentId,
    plan,
    subject,
    board,
    level,
    weekStart,
    onChanged,
    metrics,
    studentReflection: checkin.sentReflection || null,
    studentFeltReady: checkin.coveredOk,
  });
  return (
    <WeekReviewView
      firstName={firstName}
      lanes={lanes}
      checkin={
        take.hasCheckin
          ? {
              felt:
                checkin.coveredOk === false
                  ? "Wanted more practice."
                  : checkin.coveredOk
                    ? "Felt confident to move on."
                    : "",
              said: checkin.sentReflection,
            }
          : null
      }
      note={
        take.error
          ? { state: "error", error: take.error, retry: take.retry }
          : !take.loaded
            ? { state: "loading" }
            : {
                state: "ready",
                value: take.note,
                onChange: take.setNote,
                saving: take.busy === "save",
                drafting: take.drafting,
                onSave: () => void take.saveNote(),
                onDraft: () => void take.draftWithAI(),
              }
      }
    />
  );
}
