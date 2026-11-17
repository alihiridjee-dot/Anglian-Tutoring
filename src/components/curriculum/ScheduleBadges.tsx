import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Meter } from "@/components/Shared";
import { cn } from "@/lib/utils";
import { plannerDateLabel, relativeWeekLabel, weekKeyToDate } from "@/lib/planner/week";
import type { PointWhen } from "@/lib/planner/pointSchedule";

/** The week a point was due to be delivered: a catch-up keeps its first week. */
function dueWeek(when: PointWhen): string | undefined {
  return when.kind === "catchUp" ? (when.planned ?? when.week) : when.week;
}

/**
 * How it went, or how it stands, under the due week: the same five answers on
 * every point. `tone` paints it: a tint, or the kit's yellow for what's live.
 */
function outcome(
  when: PointWhen,
  now: string,
): { emoji: string; words: string; date?: string; tone?: string } {
  if (when.kind === "covered") return { emoji: "✅", words: "Covered", tone: "tint-emerald" };
  if (when.kind === "missed")
    return { emoji: "⚠️", words: "Missed", date: "No slot yet", tone: "tint-rose" };
  if (when.kind === "catchUp")
    return {
      emoji: "🔁",
      words: "Catch-up",
      date: when.week === now ? "this week" : dayMonth(when.week, now),
      tone: "pop",
    };
  if (when.week === now) return { emoji: "📍", words: "This week", tone: "pop" };
  return { emoji: "🗓️", words: relativeWeekLabel(when.week, now) };
}

/** "11 Jan", with the year only when it isn't this one. */
function dayMonth(week: string, now: string): string {
  const d = weekKeyToDate(week);
  return plannerDateLabel(d, {
    day: "numeric",
    month: "short",
    ...(week.slice(0, 4) !== now.slice(0, 4) && { year: "numeric" }),
  });
}

/**
 * When a spec point was to be delivered, as a page torn off a calendar beside
 * its title: the month, the Monday of its due week, and under the tear how it
 * went. Every point draws the same tile in the same place, and it opens that
 * week of the student's full plan (a catch-up opens its catch-up week).
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
  const due = dueWeek(when);
  const date = due ? weekKeyToDate(due) : null;
  const month =
    date &&
    plannerDateLabel(date, {
      month: "short",
      ...(due!.slice(0, 4) !== now.slice(0, 4) && { year: "numeric" }),
    });
  const day = date && plannerDateLabel(date, { day: "numeric" });
  const out = outcome(when, now);
  const label = `${due ? `Due the week of ${dayMonth(due, now)}` : "Not in your plan's weeks"}. ${out.words}${out.date ? ` ${out.date}` : ""}.`;
  const body = (
    <>
      <span className="point-cal-page">
        <span className="point-cal-month">{month ?? "Your plan"}</span>
        <span aria-hidden className="point-cal-day numeral">
          {day ?? "✓"}
        </span>
        <span className="point-cal-sub">Due week</span>
      </span>
      <span
        className={cn("point-cal-outcome", out.tone !== "pop" && out.tone)}
        data-tone={out.tone === "pop" ? "pop" : undefined}
      >
        <span>
          <span aria-hidden>{out.emoji}</span> {out.words}
        </span>
        {out.date && <span className="block">{out.date}</span>}
      </span>
    </>
  );
  const target = when.kind === "catchUp" ? when.week : due;
  if (!target)
    return (
      <span className="point-cal" aria-label={label}>
        {body}
      </span>
    );
  return (
    <Link
      to="/planner"
      search={{ subject, tab: "plan", week: target }}
      className="point-cal"
      aria-label={`${label} Open this week in your planner`}
    >
      {body}
    </Link>
  );
}

/**
 * The due week on a spec point's row in the topic list, by the same rule as
 * the calendar tile: "Due 2 Nov", "Due this week", "Catch-up 11 Jan", "Missed 2 Nov".
 */
export function WhenWord({ when, now }: { when: PointWhen; now: string }) {
  const due = dueWeek(when);
  const [words, tone] =
    when.kind === "catchUp"
      ? [`Catch-up ${when.week === now ? "this week" : dayMonth(when.week, now)}`, undefined]
      : when.kind === "missed"
        ? [`Missed ${dayMonth(when.week, now)}`, "tint-rose"]
        : !due
          ? [null, undefined]
          : when.kind === "planned" && due === now
            ? ["Due this week", undefined]
            : [`Due ${dayMonth(due, now)}`, when.kind === "covered" ? "tint-emerald" : undefined];
  if (!words) return null;
  return (
    <span
      className={cn(
        "font-display text-xs font-bold whitespace-nowrap text-[color:color-mix(in_oklab,var(--tint)_70%,var(--foreground))]",
        tone,
      )}
    >
      {words}
    </span>
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
