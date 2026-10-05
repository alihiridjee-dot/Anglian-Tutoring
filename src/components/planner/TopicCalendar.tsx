import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PacingBand } from "@/lib/planner/pacing";
import { plannerDateLabel, toDateKey, weekKeyToDate } from "@/lib/planner/week";

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const ROW = "grid grid-cols-[1.75rem_repeat(7,minmax(0,1fr))] items-center";

// Plain UTC arithmetic on calendar keys: a few hundred cells, none of which
// needs the London-time conversion `weekKeyToDate` does for real instants.
const utc = (key: string) => new Date(`${key}T00:00:00Z`);
function plusDays(key: string, n: number) {
  const d = utc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function nextMonth(ym: string) {
  const d = utc(`${ym}-01`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

/**
 * The new order drawn as wall-calendar months, from the week the change starts
 * to the exam week. Each week row wears its topic's colour; weeks before the
 * change are faded, because the reorder can't touch them.
 */
export function TopicCalendar({
  bands,
  from,
  examDate,
  tintOf,
  numberOf,
  focus,
  label,
}: {
  /** The reordered teaching from `from` on. */
  bands: PacingBand[];
  from: string;
  examDate: string;
  tintOf: (topicId: string) => string;
  /** The topic's place in the new order, as shown on its card. */
  numberOf: (topicId: string) => number;
  /** A topic the student is pointing at in the list: its weeks stay bright. */
  focus: string | null;
  label: string;
}) {
  const today = toDateKey(new Date());
  const months: string[] = [];
  for (
    let ym = from.slice(0, 7);
    ym <= examDate.slice(0, 7) && months.length < 36;
    ym = nextMonth(ym)
  )
    months.push(ym);
  return (
    <div className="@container" role="group" aria-label={label}>
      <div className="grid gap-x-6 gap-y-6 @md:grid-cols-2">
        {months.map((ym) => {
          const first = `${ym}-01`;
          const end = `${nextMonth(ym)}-01`;
          const rows: { week: string; topicId: string | null; exam: boolean }[] = [];
          for (
            let week = plusDays(first, -((utc(first).getUTCDay() + 6) % 7));
            week < end;
            week = plusDays(week, 7)
          ) {
            const band =
              week >= from ? bands.find((b) => b.startWeek <= week && b.endWeek >= week) : null;
            rows.push({ week, topicId: band?.topicId ?? null, exam: week === examDate });
          }
          return (
            <section key={ym} className="text-xs">
              <h3 className="text-sm font-bold mb-2">
                {plannerDateLabel(weekKeyToDate(first), { month: "long", year: "numeric" })}
              </h3>
              <div className={cn(ROW, "text-center font-bold mb-1")} aria-hidden>
                <span />
                {DAYS.map((d, i) => (
                  <span key={i}>{d}</span>
                ))}
              </div>
              {rows.map((row, i) => {
                const run = row.topicId ?? (row.exam ? "exam" : null);
                const prev = rows[i - 1],
                  next = rows[i + 1];
                const joinsPrev = !!run && (prev?.topicId ?? (prev?.exam ? "exam" : null)) === run;
                const joinsNext = !!run && (next?.topicId ?? (next?.exam ? "exam" : null)) === run;
                return (
                  <div
                    key={row.week}
                    className={cn(
                      ROW,
                      "transition-opacity duration-200",
                      row.topicId && tintOf(row.topicId),
                      row.exam && "tint-slate",
                      row.week < from && "opacity-40",
                      focus && row.topicId !== focus && "opacity-30",
                      !joinsPrev && "mt-1",
                    )}
                    title={row.exam ? "Exams start" : undefined}
                  >
                    <span className="flex justify-center">
                      {run && !joinsPrev && (
                        <span className="icon-tile numeral size-5 rounded-md text-[0.65rem]">
                          {row.exam ? (
                            <GraduationCap className="size-3" aria-label="Exams start" />
                          ) : (
                            numberOf(row.topicId!)
                          )}
                        </span>
                      )}
                    </span>
                    <div
                      className={cn(
                        "col-span-7 grid grid-cols-7 py-1 text-center transition-colors duration-300",
                        run && "bg-[color:color-mix(in_oklab,var(--tint)_20%,var(--card))]",
                        !joinsPrev && "rounded-t-lg",
                        !joinsNext && "rounded-b-lg",
                      )}
                    >
                      {DAYS.map((_, d) => {
                        const day = plusDays(row.week, d);
                        if (day.slice(0, 7) !== ym) return <span key={d} />;
                        return (
                          <span
                            key={d}
                            className={cn(
                              "mx-auto flex size-5 items-center justify-center tabular-nums",
                              day === today &&
                                "rounded-full font-bold ring-2 ring-[color:var(--foreground)]",
                            )}
                            aria-current={day === today ? "date" : undefined}
                          >
                            {Number(day.slice(8))}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
