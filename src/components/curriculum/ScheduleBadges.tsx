import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  History,
  type LucideIcon,
} from "lucide-react";
import { Meter } from "@/components/Shared";
import { cn } from "@/lib/utils";
import { plannerDateLabel, weekKeyToDate } from "@/lib/planner/week";
import type { PointWhen } from "@/lib/planner/pointSchedule";

/** The planned weeks are the kit's yellow sticker; done and missed take a colour. */
const WHEN_STYLE: Record<
  "covered" | "thisWeek" | "planned" | "catchUp" | "missed",
  { label: string; icon: LucideIcon; tint?: string }
> = {
  covered: { label: "Covered", icon: CheckCircle2, tint: "tint-emerald" },
  thisWeek: { label: "This week", icon: CalendarDays },
  planned: { label: "Week of", icon: CalendarDays },
  catchUp: { label: "Catch-up, week of", icon: History },
  missed: { label: "Missed, no slot yet", icon: AlertTriangle, tint: "tint-rose" },
};

/**
 * When a spec point is due for this student: a sticker beside the point's
 * title, and a button into that week of their full plan.
 */
export function WhenLink({
  when,
  now,
  subject,
}: {
  when: PointWhen;
  now: string;
  subject: string;
}) {
  const kind = when.kind === "planned" && when.week === now ? "thisWeek" : when.kind;
  const style = WHEN_STYLE[kind];
  const Icon = style.icon;
  // The year only when it isn't this one.
  const date = when.week ? weekKeyToDate(when.week) : null;
  const week =
    date &&
    plannerDateLabel(date, {
      day: "numeric",
      month: "short",
      ...(date.getFullYear() !== weekKeyToDate(now).getFullYear() && { year: "numeric" }),
    });
  const words =
    week && (kind === "planned" || kind === "catchUp") ? `${style.label} ${week}` : style.label;
  const body = (
    <>
      <Icon className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
      {words}
    </>
  );
  const className = cn(
    "sticker point-week min-h-11 shrink-0 items-center sm:pointer-fine:min-h-0",
    style.tint && "sticker-alt",
    style.tint,
  );

  if (!when.week) return <span className={className}>{body}</span>;
  return (
    <Link
      to="/planner"
      search={{ subject, tab: "plan", week: when.week }}
      className={className}
      aria-label={`${words}${week && !words.includes(week) ? `, week of ${week}` : ""}. Open this week in your planner`}
    >
      {body}
    </Link>
  );
}

/** How much of a topic is covered, for the right-hand end of its ribbon. */
export function TopicCoverage({ covered, total }: { covered: number; total: number }) {
  return (
    <span
      className={cn(
        "flex w-full sm:ml-auto sm:w-40 shrink-0 items-center gap-2",
        total > 0 && covered === total && "tint-emerald",
      )}
    >
      <Meter value={total ? (covered / total) * 100 : 0} size="sm" className="flex-1" />
      <span aria-hidden className="numeral text-xs text-[color:var(--tint)]">
        {covered}/{total}
      </span>
      <span className="sr-only">
        {covered} of {total} spec points covered
      </span>
    </span>
  );
}

/** Stands in for {@link TopicCoverage} while the student's plan loads. */
export function TopicCoverageLoading() {
  return (
    <span
      aria-hidden
      className="h-2 w-full sm:ml-auto sm:w-40 shrink-0 rounded-full bg-[color:color-mix(in_oklab,var(--tint)_14%,transparent)] animate-pulse"
    />
  );
}

/** A checkbox on a spec point: ticked once the student has covered it, empty until then. */
export function CoverageBox({ covered }: { covered: boolean }) {
  return (
    <span className={cn("ml-auto shrink-0", covered && "tint-emerald pop-in")}>
      <span
        aria-hidden
        className={cn(
          "flex size-6 items-center justify-center rounded-md border-[1.5px]",
          covered
            ? "border-[color:color-mix(in_oklab,var(--tint)_60%,var(--primary-deep))] bg-[color:var(--tint)] text-white shadow-[0_2px_0_0_color-mix(in_oklab,var(--tint)_40%,transparent)]"
            : "border-[color:color-mix(in_oklab,var(--tint)_30%,var(--edge))] bg-card",
        )}
      >
        {covered && <Check className="size-4" strokeWidth={3.5} />}
      </span>
      <span className="sr-only">{covered ? "Covered" : "Not covered yet"}</span>
    </span>
  );
}
