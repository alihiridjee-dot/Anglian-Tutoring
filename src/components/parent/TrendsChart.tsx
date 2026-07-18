import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { WeeklyTrendPoint } from "@/hooks/data/useChildProgress";
import { SUBJECT_STROKE, SUBJECT_TEXT, subjectLabel } from "@/components/parent/subjectTheme";

/**
 * Weekly quiz averages per subject. Weeks with no attempts leave a gap in that
 * subject's line (connectNulls bridges it) rather than plotting a fake zero.
 */
export function TrendsChart({
  points,
  subjects,
}: {
  points: WeeklyTrendPoint[];
  subjects: string[];
}) {
  const hasAny = points.some((p) => Object.keys(p.averages).length > 0);

  const data = points.map((p) => ({
    label: p.label,
    ...Object.fromEntries(subjects.map((s) => [s, p.averages[s] ?? null])),
  }));

  const config = Object.fromEntries(
    subjects.map((s) => [s, { label: subjectLabel(s), color: SUBJECT_STROKE[s] ?? "#64748b" }]),
  ) satisfies ChartConfig;

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-display text-lg font-bold text-slate-900">Performance Trends</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Weekly quiz averages over the past six weeks.
          </p>
        </div>
        <div className="flex gap-4 text-xs font-semibold">
          {subjects.map((s) => (
            <span
              key={s}
              className={`inline-flex items-center gap-1.5 ${SUBJECT_TEXT[s] ?? "text-slate-600"}`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: SUBJECT_STROKE[s] ?? "#64748b" }}
              />
              {subjectLabel(s)}
            </span>
          ))}
        </div>
      </div>

      {!hasAny ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No quiz attempts in the last six weeks — the chart fills in as your child completes weekly
          MCQs.
        </p>
      ) : (
        <div className="h-64">
          <ChartContainer config={config}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  dy={10}
                  style={{ fontSize: "11px", fill: "#64748b" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  dx={-5}
                  style={{ fontSize: "11px", fill: "#64748b" }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                {subjects.map((s) => (
                  <Line
                    key={s}
                    type="monotone"
                    dataKey={s}
                    name={subjectLabel(s)}
                    stroke={SUBJECT_STROKE[s] ?? "#64748b"}
                    strokeWidth={2.5}
                    connectNulls
                    dot={{ r: 4, strokeWidth: 0, fill: SUBJECT_STROKE[s] ?? "#64748b" }}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      )}
    </div>
  );
}
