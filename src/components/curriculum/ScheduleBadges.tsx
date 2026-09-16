import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  History,
  type LucideIcon,
} from "lucide-react";
import { Meter } from "@/components/Shared";
import { cn } from "@/lib/utils";
import { plannerDateLabel, weekKeyToDate } from "@/lib/week";
import type { PointWhen } from "@/lib/planner/pointSchedule";

const WHEN_STYLE: Record<
  "covered" | "thisWeek" | "planned" | "catchUp" | "missed",
  { label: string; icon: LucideIcon; tint?: string }
> = {
  covered: { label: "Covered", icon: CheckCircle2, tint: "tint-emerald" },
  thisWeek: { label: "This week", icon: CalendarDays, tint: "tint-amber" },
  planned: { label: "Planned for", icon: CalendarDays },
  catchUp: { label: "Catch-up week", icon: History, tint: "tint-amber" },
  missed: { label: "Missed · no slot yet", icon: AlertTriangle, tint: "tint-rose" },
};

/**
 * When a spec point is due for this student, as a button into that week of
 * their full plan. Ordinary planned weeks take the subject tint from the page.
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
  const style = WHEN_STYLE[when.kind === "planned" && when.week === now ? "thisWeek" : when.kind];
  const Icon = style.icon;
  const week = when.week
    ? plannerDateLabel(weekKeyToDate(when.week), {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
  const body = (
    <>
      <span className="icon-tile size-11 shrink-0">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="eyebrow eyebrow-bare block text-[10px]">{style.label}</span>
        <span className="font-display mt-1 block text-base leading-tight font-extrabold">
          {week ? `Week of ${week}` : "Nice work"}
        </span>
      </span>
      {when.week && (
        <span className="when-link-arrow" aria-hidden>
          <ArrowRight className="size-4" />
        </span>
      )}
    </>
  );
  const className = cn(
    "when-link flex w-full items-center gap-3 p-2.5 pr-3 sm:w-auto sm:min-w-72 sm:inline-flex",
    style.tint,
  );

  if (!when.week) return <div className={className}>{body}</div>;
  return (
    <Link
      to="/planner"
      search={{ subject, tab: "plan", week: when.week }}
      className={className}
      aria-label={`${style.label}: week of ${week}. Open this week in your planner`}
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
