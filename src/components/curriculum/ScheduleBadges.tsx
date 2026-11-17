import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Chip, Meter } from "@/components/Shared";
import { cn } from "@/lib/utils";
import { plannerDateLabel, relativeWeekLabel, sundayOf, weekKeyToDate } from "@/lib/planner/week";
import type { PointWhen } from "@/lib/planner/pointSchedule";

/** The week a point was due to be delivered: a catch-up keeps its first week. */
function dueWeek(when: PointWhen): string | undefined {
  return when.kind === "catchUp" ? (when.planned ?? when.week) : when.week;
}

/** Where a point stands now: the same five answers on every point. */
function status(when: PointWhen, now: string): { emoji: string; words: string; tint: string } {
  if (when.kind === "covered") return { emoji: "✅", words: "Covered", tint: "tint-emerald" };
  if (when.kind === "missed" || when.kind === "catchUp")
    return { emoji: "⚠️", words: "Missed", tint: "tint-rose" };
  if (when.week === now) return { emoji: "📍", words: "This week", tint: "tint-amber" };
  return { emoji: "🗓️", words: relativeWeekLabel(when.week, now), tint: "" };
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

/** A week as its Monday to Sunday: "17–23 Aug", "30 Nov – 6 Dec", "11–17 Jan 2027". */
function weekSpan(week: string, now: string): string {
  const monday = weekKeyToDate(week);
  const sunday = sundayOf(monday);
  const year = week.slice(0, 4) !== now.slice(0, 4) ? ` ${week.slice(0, 4)}` : "";
  const day = (d: Date) => plannerDateLabel(d, { day: "numeric" });
  const month = (d: Date) => plannerDateLabel(d, { month: "short" });
  return month(monday) === month(sunday)
    ? `${day(monday)}–${day(sunday)} ${month(sunday)}${year}`
    : `${day(monday)} ${month(monday)} – ${day(sunday)} ${month(sunday)}${year}`;
}

/**
 * When a spec point was to be delivered, in a straight panel beside its work:
 * the week it was due, where it stands, and the catch-up week if it was
 * missed. The same three rows on every point, and a button into that week of
 * the student's plan (a catch-up opens its catch-up week).
 */
export function WhenPanel({
  when,
  now,
  subject,
  className,
}: {
  when: PointWhen;
  now: string;
  subject: string;
  className?: string;
}) {
  const due = dueWeek(when);
  const state = status(when, now);
  const catchUp =
    when.kind === "catchUp"
      ? weekSpan(when.week, now)
      : when.kind === "missed"
        ? "No slot yet"
        : null;
  const target = when.kind === "catchUp" ? when.week : due;
  return (
    <aside aria-label="When" className={cn("premium-card overflow-hidden", className)}>
      <h3 className="font-display flex items-center gap-2 bg-[color:var(--tint)] px-5 py-3 text-lg font-extrabold text-white">
        <span aria-hidden>🗓️</span> When
      </h3>
      <dl className="divide-y divide-border">
        <WhenRow label="Due week">{due ? weekSpan(due, now) : "—"}</WhenRow>
        <WhenRow label="Status">
          <Chip tint={state.tint} className="px-2.5! py-1! text-sm!">
            <span aria-hidden>{state.emoji}</span> {state.words}
          </Chip>
        </WhenRow>
        <WhenRow label="Catch-up">
          {catchUp && when.kind === "catchUp" ? (
            <Chip tint="tint-amber" className="px-2.5! py-1! text-sm!">
              <span aria-hidden>🔁</span> {catchUp}
            </Chip>
          ) : (
            (catchUp ?? "—")
          )}
        </WhenRow>
      </dl>
      {target && (
        <div className="px-5 pt-1 pb-5">
          <Link
            to="/planner"
            search={{ subject, tab: "plan", week: target }}
            className="btn-solid flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2.5"
          >
            Open in planner →
          </Link>
        </div>
      )}
    </aside>
  );
}

function WhenRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <dt className="font-bold">{label}</dt>
      <dd className="font-display text-right text-lg font-extrabold">{children}</dd>
    </div>
  );
}

/**
 * The due week on a spec point's row in the topic list, by the same rule as
 * the When panel: "Due 2 Nov", "Due this week", "Catch-up 11 Jan", "Missed 2 Nov".
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
