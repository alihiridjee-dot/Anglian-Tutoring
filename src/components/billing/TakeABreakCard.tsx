import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, TreePalm } from "lucide-react";
import { toast } from "sonner";
import { BreakDAL } from "@/lib/planner/breaksDal";
import { studentBreaksQuery } from "@/lib/planner/breakQueries";
import { backOn, breakDay, breakReasonLabel, type StudentBreak } from "@/lib/planner/breaks";
import { invalidatePlanner } from "@/lib/planner/queries";
import { currentWeekKey } from "@/lib/planner/week";
import { TakeABreakDialog } from "./TakeABreakDialog";

/**
 * One break that stands, with the one thing to do about it: come back early
 * from a break under way, or call off one still to come. Both ask once more
 * before they act.
 */
function StandingBreak({
  brk,
  studentId,
  name,
  underWay,
}: {
  brk: StudentBreak;
  studentId: string;
  name?: string;
  underWay: boolean;
}) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const end = async () => {
    setPending(true);
    try {
      await BreakDAL.end(brk.id);
      await invalidatePlanner(client, studentId);
      toast.success(underWay ? (name ? `${name} is back` : "Welcome back") : "Break called off");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  const action = underWay ? (name ? "End it early" : "I'm back early") : "Call it off";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1.5">
        <span className="chip">{breakReasonLabel(brk.reason)}</span>
        <span className="chip">
          {underWay
            ? `Back ${breakDay(backOn(brk))}`
            : `${breakDay(brk.startsOn)} – ${breakDay(brk.endsOn)}`}
        </span>
      </div>
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="btn-ghost h-11 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={() => void end()}
            disabled={pending}
            className="btn-solid inline-flex h-11 items-center gap-2 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {underWay ? "Yes, end it" : "Yes, call it off"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn-soft h-11 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
        >
          {action}
        </button>
      )}
    </div>
  );
}

/**
 * Take a break, at the top of Billing (Ali, 5 Oct 2026).
 *
 * A break stops the student's weekly work for up to four weeks while the plan
 * and its payments carry on, which is why it sits beside them rather than
 * inside the planner. The student, a linked parent or a tutor can book one;
 * the parent and tutor see the student's name.
 *
 * Shows the breaks that stand — one under way, or still to come — with a way
 * to end or call off each, and books new ones through TakeABreakDialog.
 */
export function TakeABreakCard({
  studentId,
  name,
}: {
  studentId: string;
  /** The student's first name, on a parent's or tutor's page. */
  name?: string;
}) {
  const { data: breaks = [], isPending } = useQuery(studentBreaksQuery(studentId));
  const [open, setOpen] = useState(false);
  // Until the breaks are read, the card can't say which state it is in.
  if (isPending) return null;

  const thisWeek = currentWeekKey();
  const standing = breaks.filter((b) => b.endsOn >= thisWeek);
  const underWay = (b: StudentBreak) => b.startsOn <= thisWeek;
  const title = !standing.length
    ? "Take a break"
    : underWay(standing[0])
      ? name
        ? `${name} is on a break`
        : "You're on a break"
      : standing.length > 1
        ? "Breaks booked"
        : "Break booked";

  return (
    <section data-guide="take-a-break" className="tint-accent premium-card rounded-2xl p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="icon-tile size-10 shrink-0">
          <TreePalm className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <h2 className="text-lg leading-tight">{title}</h2>
          {standing.length ? (
            <div className="space-y-2.5">
              {standing.map((b) => (
                <StandingBreak
                  key={b.id}
                  brk={b}
                  studentId={studentId}
                  name={name}
                  underWay={underWay(b)}
                />
              ))}
            </div>
          ) : (
            <p>
              {name
                ? `Pause ${name}'s weekly work for up to 4 weeks. The plan and its payments carry on.`
                : "Away, or swamped with school work? Pause your weekly work for up to 4 weeks. Your plan and its payments carry on."}
            </p>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`${standing.length ? "btn-soft" : "btn-solid"} inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm sm:pointer-fine:h-10`}
          >
            <TreePalm className="size-4" />
            {standing.length ? "Book another break" : "Take a break"}
          </button>
        </div>
      </div>
      {open && (
        <TakeABreakDialog studentId={studentId} name={name} onClose={() => setOpen(false)} />
      )}
    </section>
  );
}
