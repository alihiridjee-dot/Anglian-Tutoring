import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { X, Loader2 } from "lucide-react";
import { PlannerDAL, type SpecPointWithConfidence } from "@/lib/plannerDal";
import { confidenceColor, bandOf } from "@/lib/planner/bands";

/**
 * The "expand a topic group" view: every spec point in the group with its own
 * 0-100 slider. Each change is persisted (debounced) on its own; when the panel
 * closes we hand the parent the new mean of the rated points so the topic card
 * can slide into the matching band.
 */
export function SpecPointSlidersModal({
  studentId,
  topicId,
  topicTitle,
  topicCode,
  onClose,
  onAggregate,
}: {
  studentId: string;
  topicId: string;
  topicTitle: string;
  topicCode: string | null;
  onClose: () => void;
  onAggregate: (mean: number | null) => void;
}) {
  const [points, setPoints] = useState<SpecPointWithConfidence[]>([]);
  const [loading, setLoading] = useState(true);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let alive = true;
    PlannerDAL.getSpecPointsWithConfidence(studentId, topicId)
      .then((p) => {
        if (alive) setPoints(p);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [studentId, topicId]);

  // Snapshot of timers for cleanup — captured so the unmount effect doesn't read
  // a mutated ref later.
  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  const ratedMean = useMemo(() => {
    const rated = points.filter((p) => p.confidence != null);
    if (rated.length === 0) return null;
    return Math.round(rated.reduce((s, p) => s + (p.confidence ?? 0), 0) / rated.length);
  }, [points]);

  const setValue = (id: string, value: number) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, confidence: value } : p)));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      PlannerDAL.setSpecPointConfidence(id, value).catch((e) =>
        console.error("save spec point confidence", e),
      );
    }, 400);
  };

  const close = () => {
    // Flush any pending debounced writes so nothing is lost on close.
    Object.values(timers.current).forEach(clearTimeout);
    Promise.all(
      points
        .filter((p) => p.confidence != null)
        .map((p) =>
          PlannerDAL.setSpecPointConfidence(p.id, p.confidence as number).catch(() => {}),
        ),
    ).finally(() => {
      onAggregate(ratedMean);
      onClose();
    });
  };

  const ratedCount = points.filter((p) => p.confidence != null).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="relative w-full sm:max-w-lg max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-card border border-border shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div className="min-w-0">
            {topicCode && (
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {topicCode}
              </div>
            )}
            <h2 className="font-display text-lg font-semibold tracking-tight truncate">
              {topicTitle}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Rate how confident you feel on each point — drag the sliders.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="shrink-0 w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center"
            aria-label="Done"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-10 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : points.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No specification points for this topic yet.
            </p>
          ) : (
            points.map((p) => <SpecPointSlider key={p.id} point={p} onChange={setValue} />)
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-4 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {ratedCount} of {points.length} rated
          </span>
          <button
            type="button"
            onClick={close}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function SpecPointSlider({
  point,
  onChange,
}: {
  point: SpecPointWithConfidence;
  onChange: (id: string, value: number) => void;
}) {
  const value = point.confidence ?? 50;
  const rated = point.confidence != null;
  const color = rated ? confidenceColor(value) : "#94a3b8"; // slate-400 when untouched

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">
            {point.code}
          </span>
          <span className="text-sm">{point.title}</span>
        </div>
        <span
          className="text-xs font-semibold tabular-nums shrink-0"
          style={{ color: rated ? color : undefined }}
        >
          {rated ? bandOf(value).label : "—"}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(point.id, Number(e.target.value))}
        className="planner-slider w-full"
        style={{ accentColor: color }}
      />
    </div>
  );
}
