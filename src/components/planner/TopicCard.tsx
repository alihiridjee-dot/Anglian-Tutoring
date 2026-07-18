import { GripVertical, Sliders } from "lucide-react";
import { type TopicWithConfidence } from "@/lib/plannerDal";
import { confidenceColor, bandOf } from "@/lib/planner/bands";

/** A draggable topic-group card. Shows a confidence ring and opens the sliders. */
export function TopicCard({
  topic,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  topic: TopicWithConfidence;
  onOpen: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const rated = topic.confidence != null;
  const value = topic.confidence ?? 0;

  return (
    <div
      draggable
      onDragStart={(e) => {
        // The dragged id rides on the event itself, so the drop handler never
        // has to race React state to know what was dropped.
        e.dataTransfer.setData("text/plain", topic.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(topic.id);
      }}
      onDragEnd={onDragEnd}
      className={`group rounded-xl border bg-card p-3 flex items-center gap-3 transition select-none cursor-grab active:cursor-grabbing ${
        dragging
          ? "opacity-40 border-primary"
          : "border-border hover:border-primary/50 hover:shadow-sm"
      }`}
    >
      <GripVertical className="w-4 h-4 text-muted-foreground/50 shrink-0" />
      <ConfidenceRing value={value} rated={rated} />
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
        {topic.code && (
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {topic.code}
          </div>
        )}
        <div className="text-sm font-medium leading-snug line-clamp-2">{topic.title}</div>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center opacity-60 group-hover:opacity-100 transition"
        aria-label="Rate specification points"
        title="Rate specification points"
      >
        <Sliders className="w-4 h-4" />
      </button>
    </div>
  );
}

function ConfidenceRing({ value, rated }: { value: number; rated: boolean }) {
  const size = 34;
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = rated ? confidenceColor(value) : "#cbd5e1"; // slate-300 when unrated
  const dash = rated ? (value / 100) * c : c;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      title={rated ? bandOf(value).label : "Not rated yet"}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-muted/40"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: "stroke-dasharray 0.3s ease, stroke 0.3s ease" }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums"
        style={{ color: rated ? color : "#94a3b8" }}
      >
        {rated ? value : "–"}
      </span>
    </div>
  );
}
