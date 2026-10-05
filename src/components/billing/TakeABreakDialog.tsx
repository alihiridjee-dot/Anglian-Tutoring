import { useEffect, useId, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, TreePalm, X } from "lucide-react";
import { toast } from "sonner";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { cn } from "@/lib/utils";
import { BreakDAL } from "@/lib/planner/breaksDal";
import { examDatesQuery, studentBreaksQuery } from "@/lib/planner/breakQueries";
import {
  BREAK_REASONS,
  MAX_BREAK_WEEKS,
  breakDay,
  mondayKeyOf,
  overlapsBreak,
  runWeeks,
  shiftKey,
  touchesExam,
  type BreakReason,
} from "@/lib/planner/breaks";
import { invalidatePlanner } from "@/lib/planner/queries";
import { currentWeekKey } from "@/lib/planner/week";

type StartChoice = "this" | "next" | "later";

/** One option in a row of choices: the solid button is the one picked. */
function Choice({
  picked,
  disabled,
  onPick,
  children,
}: {
  picked: boolean;
  disabled?: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={picked}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "min-h-11 rounded-full px-3.5 text-sm sm:pointer-fine:min-h-9",
        picked ? "btn-solid" : "btn-soft",
        "disabled:cursor-not-allowed disabled:opacity-45",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The booking form for a break: when it starts, when the student is back, and
 * why. All three are needed. Weeks the database would refuse — too close to an
 * exam, clashing with a break already booked, or running past four weeks in a
 * row — can't be picked, and `book_break` checks them all again.
 *
 * Booked by the student for themselves, or by a parent or tutor, who see the
 * student's name in the questions.
 */
export function TakeABreakDialog({
  studentId,
  name,
  onClose,
}: {
  studentId: string;
  /** The student's first name, when a parent or tutor is booking. */
  name?: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const ids = useId();
  const thisWeek = currentWeekKey();
  const [start, setStart] = useState<StartChoice | null>(null);
  const [laterDate, setLaterDate] = useState("");
  const [weeks, setWeeks] = useState<number | null>(null);
  const [reason, setReason] = useState<BreakReason | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: breaks = [] } = useQuery(studentBreaksQuery(studentId));
  const { data: exams = [] } = useQuery(examDatesQuery(studentId));
  // Breaks that are over can't clash with a new one, which starts this week at the earliest.
  const standing = useMemo(() => breaks.filter((b) => b.endsOn >= thisWeek), [breaks, thisWeek]);

  const startsOn =
    start === "this"
      ? thisWeek
      : start === "next"
        ? shiftKey(thisWeek, 7)
        : start === "later" && laterDate
          ? mondayKeyOf(laterDate)
          : null;

  /** Why a break of `w` weeks from the chosen start can't be booked, if it can't. */
  const refusal = (w: number): string | null => {
    if (!startsOn) return null;
    if (exams.some((e) => touchesExam({ startsOn, weeks: w, examDate: e.examDate })))
      return "Too close to an exam";
    if (overlapsBreak(standing, startsOn, w)) return "Clashes with a break already booked";
    if (runWeeks(standing, startsOn, w) > MAX_BREAK_WEEKS) return "More than 4 weeks in a row";
    return null;
  };
  const options = Array.from({ length: MAX_BREAK_WEEKS }, (_, i) => i + 1).map((w) => ({
    weeks: w,
    back: startsOn ? shiftKey(startsOn, 7 * w) : null,
    refusal: refusal(w),
  }));
  const refusals = [...new Set(options.map((o) => o.refusal).filter((r): r is string => !!r))];
  const picked = options.find((o) => o.weeks === weeks && !o.refusal) ?? null;

  const ready = !!startsOn && !!picked && !!reason && !pending;
  const dirty = !!start || !!weeks || !!reason;

  // The page holds still underneath. Escape closes; a tap outside closes too,
  // unless something has been picked.
  useBodyScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const book = async () => {
    if (!startsOn || !picked || !reason) return;
    setPending(true);
    setError(null);
    try {
      await BreakDAL.book({ studentId, startsOn, weeks: picked.weeks, reason });
      await invalidatePlanner(client, studentId);
      toast.success(`Break booked. Back ${breakDay(picked.back!)}.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The break couldn't be booked. Try again.");
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary-deep/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${ids}-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !dirty && !pending) onClose();
      }}
    >
      <div className="tint-accent premium-card w-full max-w-lg rounded-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="icon-tile size-10 shrink-0">
              <TreePalm className="size-5" />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`${ids}-title`} className="text-lg leading-tight">
                Take a break
              </h2>
              {name && <span className="chip">{name}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="btn-ghost flex size-11 shrink-0 items-center justify-center rounded-lg sm:pointer-fine:size-8"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-6 p-4 text-sm sm:p-6">
          <section className="space-y-2.5">
            <h3 id={`${ids}-start`} className="text-sm">
              When does it start?
            </h3>
            <div
              role="radiogroup"
              aria-labelledby={`${ids}-start`}
              className="flex flex-wrap gap-2"
            >
              <Choice picked={start === "this"} onPick={() => setStart("this")}>
                This week
              </Choice>
              <Choice picked={start === "next"} onPick={() => setStart("next")}>
                Next week
              </Choice>
              <Choice picked={start === "later"} onPick={() => setStart("later")}>
                Later
              </Choice>
            </div>
            {start === "later" && (
              <label className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">The week of</span>
                <input
                  type="date"
                  value={laterDate}
                  min={shiftKey(thisWeek, 14)}
                  max={shiftKey(thisWeek, 364)}
                  onChange={(e) => setLaterDate(e.target.value)}
                  className="min-h-11 rounded-lg border border-border bg-background px-2.5 text-sm sm:pointer-fine:min-h-9"
                />
              </label>
            )}
            {startsOn && <span className="chip">Starts {breakDay(startsOn)}</span>}
          </section>

          <section className="space-y-2.5">
            <h3 id={`${ids}-back`} className="text-sm">
              When will {name ? `${name} be` : "you be"} back?
            </h3>
            <div role="radiogroup" aria-labelledby={`${ids}-back`} className="flex flex-wrap gap-2">
              {options.map((o) => (
                <Choice
                  key={o.weeks}
                  picked={picked?.weeks === o.weeks}
                  disabled={!o.back || !!o.refusal}
                  onPick={() => setWeeks(o.weeks)}
                >
                  {o.back && `${breakDay(o.back)} · `}
                  {o.weeks} {o.weeks === 1 ? "week" : "weeks"}
                </Choice>
              ))}
            </div>
            {refusals.length > 0 && (
              <div className="tint-rose flex flex-wrap gap-1.5">
                {refusals.map((r) => (
                  <span key={r} className="chip">
                    {r}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2.5">
            <h3 id={`${ids}-why`} className="text-sm">
              Why {name ? `is ${name}` : "are you"} taking a break?
            </h3>
            <div role="radiogroup" aria-labelledby={`${ids}-why`} className="flex flex-wrap gap-2">
              {BREAK_REASONS.map((r) => (
                <Choice key={r.value} picked={reason === r.value} onPick={() => setReason(r.value)}>
                  {r.label}
                </Choice>
              ))}
            </div>
          </section>

          {error && (
            <p role="alert" className="tint-rose chip whitespace-normal">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="btn-ghost h-11 rounded-lg px-4 text-sm sm:pointer-fine:h-10"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => void book()}
              disabled={!ready}
              className="btn-solid inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm sm:pointer-fine:h-10"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Book the break
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
