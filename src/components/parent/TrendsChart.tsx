import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { WeeklyTrendPoint } from "@/hooks/data/useChildProgress";
import { SUBJECT_STROKE, SUBJECT_TEXT, subjectLabel } from "@/lib/curriculum/subjectTheme";
import { SectionHeading } from "@/components/Shared";

// Recharts takes bare colours, so these read the design tokens directly rather
// than the class names the rest of the kit uses.
const FALLBACK_STROKE = "var(--muted-foreground)";
const AXIS_TICK = { fontSize: "11px", fill: "var(--muted-foreground)" };

/**
 * Weekly quiz averages per subject. Weeks with no attempts leave a gap in that
 * subject's line (connectNulls bridges it) rather than plotting a fake zero.
 * Six quiet weeks in a row draw nothing at all, rather than an empty frame.
 */
export function TrendsChart({
  points,
  subjects,
}: {
  points: WeeklyTrendPoint[];
  subjects: string[];
}) {
  const hasAny = points.some((p) => Object.keys(p.averages).length > 0);
  if (!hasAny) return null;

  const stroke = (s: string) => SUBJECT_STROKE[s] ?? FALLBACK_STROKE;

  const data = points.map((p) => ({
    label: p.label,
    ...Object.fromEntries(subjects.map((s) => [s, p.averages[s] ?? null])),
  }));

  const config = Object.fromEntries(
    subjects.map((s) => [s, { label: subjectLabel(s), color: stroke(s) }]),
  ) satisfies ChartConfig;

  return (
    <div className="premium-card p-6">
      <SectionHeading title="Performance trends" hint="Weekly quiz averages, last six weeks">
        <div className="flex gap-4 text-xs font-semibold">
          {subjects.map((s) => (
            <span
              key={s}
              className={`inline-flex items-center gap-1.5 ${SUBJECT_TEXT[s] ?? "text-muted-foreground"}`}
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: stroke(s) }} />
              {subjectLabel(s)}
            </span>
          ))}
        </div>
      </SectionHeading>

      {/* ChartContainer brings its own ResponsiveContainer and a 16:9 aspect.
          Left at 16:9 the chart outgrew this box on any card wider than ~450px
          and ran out through the bottom of the card; it fills the box instead. */}
      <div className="mt-6 h-64">
        <ChartContainer config={config} className="aspect-auto h-full w-full">
          <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} dy={10} style={AXIS_TICK} />
            <YAxis domain={[0, 100]} tickLine={false} axisLine={false} dx={-5} style={AXIS_TICK} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {subjects.map((s) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                name={subjectLabel(s)}
                stroke={stroke(s)}
                strokeWidth={2.5}
                connectNulls
                dot={{ r: 4, strokeWidth: 0, fill: stroke(s) }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}
