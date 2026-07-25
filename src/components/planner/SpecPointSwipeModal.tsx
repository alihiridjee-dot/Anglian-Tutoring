import { useEffect, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { X, Loader2, Check, Undo2 } from "lucide-react";
import { PlannerDAL, type SpecPointWithConfidence } from "@/lib/plannerDal";
import { bandByKey, type BandKey } from "@/lib/planner/bands";

/**
 * The "expand a topic group" view: rate each spec point on the same red/amber/
 * green scale as the confidence columns (Needs work / Getting there / Confident).
 *
 * The column the topic sits in sets the topic's broad mastery; these per-point
 * ratings are a *finer* signal layered on top — each one is persisted at its raw
 * band value (never averaged with the column) and fed to the FSRS engine as a
 * confidence review, so a single weak point inside an otherwise-confident topic
 * still gets promoted and resurfaces on its own. Rating points never moves the
 * topic between columns; the only time we seed the column here is when the topic
 * hasn't been sorted at all yet, so it lands somewhere sensible.
 */

// The three bands' midpoints — the value each rating persists at (see bands.ts).
const RAG_SCORE: Record<BandKey, number> = {
  confident: bandByKey("confident").midpoint,
  getting: bandByKey("getting").midpoint,
  shaky: bandByKey("shaky").midpoint,
};
const SWIPE_THRESHOLD = 110; // px of horizontal drag to commit a decision

export function SpecPointSwipeModal({
  studentId,
  topicId,
  topicTitle,
  topicCode,
  columnConfidence,
  onClose,
  onAggregate,
}: {
  studentId: string;
  topicId: string;
  topicTitle: string;
  topicCode: string | null;
  /** The confidence of the column the topic currently sits in (null if unsorted). */
  columnConfidence: number | null;
  onClose: () => void;
  /** New topic-level confidence to settle the card into, or null to leave the column as-is. */
  onAggregate: (mean: number | null) => void;
}) {
  const [points, setPoints] = useState<SpecPointWithConfidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, BandKey>>({});
  const [saving, setSaving] = useState(false);

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

  const total = points.length;
  const decidedCount = Object.keys(choices).length;
  const done = total > 0 && decidedCount >= total;

  // Persist every rating at its raw band value — this is the per-point FSRS feed.
  // The topic column is authoritative: we only seed it from these ratings when
  // the topic has never been sorted (columnConfidence == null); otherwise it
  // stays put and these ratings just refine the schedule underneath it.
  const finish = async (finalChoices: Record<string, BandKey>) => {
    setSaving(true);
    const scores = points.map((p) => RAG_SCORE[finalChoices[p.id] ?? "getting"]);
    try {
      await Promise.all(
        points.map((p, i) => PlannerDAL.setSpecPointConfidence(p.id, scores[i]).catch(() => {})),
      );
    } finally {
      setSaving(false);
    }
    const mean = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
    onAggregate(columnConfidence == null ? mean : null);
    onClose();
  };

  const choose = (choice: BandKey) => {
    const p = points[index];
    if (!p) return;
    const next = { ...choices, [p.id]: choice };
    setChoices(next);
    if (index + 1 >= total) finish(next);
    else setIndex((i) => i + 1);
  };

  // Arrow keys drive the deck: ← needs work, ↓ getting there, → confident.
  useEffect(() => {
    if (loading || done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        choose("confident");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        choose("shaky");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        choose("getting");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, done, index, points]);

  const undo = () => {
    if (index === 0) return;
    const prev = points[index - 1];
    setChoices((c) => {
      const n = { ...c };
      delete n[prev.id];
      return n;
    });
    setIndex((i) => i - 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="relative w-full sm:max-w-md flex flex-col rounded-t-2xl sm:rounded-2xl bg-card border border-border shadow-2xl"
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
              Rate each point: needs work, getting there, or confident.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : points.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              No specification points for this topic yet.
            </p>
          ) : done ? (
            <div className="py-12 text-center">
              {saving ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mt-3">Saving your ratings…</p>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium mt-3">All done — nice work.</p>
                </>
              )}
            </div>
          ) : (
            <SwipeDeck points={points} index={index} onChoose={choose} />
          )}
        </div>

        {!loading && !done && points.length > 0 && (
          <div className="flex items-center justify-between gap-3 p-4 border-t border-border">
            <button
              type="button"
              onClick={undo}
              disabled={index === 0}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
            >
              <Undo2 className="w-4 h-4" /> Back
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.min(index + 1, total)} of {total}
            </span>
            <div className="flex items-center gap-1.5">
              <RatingButton band="shaky" onClick={() => choose("shaky")} />
              <RatingButton band="getting" onClick={() => choose("getting")} />
              <RatingButton band="confident" onClick={() => choose("confident")} />
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/** One RAG choice button, coloured from its band. */
function RatingButton({ band, onClick }: { band: BandKey; onClick: () => void }) {
  const b = bandByKey(band);
  const tone =
    band === "confident"
      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
      : band === "getting"
        ? "border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
        : "border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-[13px] font-semibold ${tone}`}
    >
      <span className={`w-2 h-2 rounded-full ${b.dot}`} />
      {b.label}
    </button>
  );
}

/** The card stack — only the top card is interactive; the next peeks behind it. */
function SwipeDeck({
  points,
  index,
  onChoose,
}: {
  points: SpecPointWithConfidence[];
  index: number;
  onChoose: (choice: BandKey) => void;
}) {
  return (
    <div className="relative h-56">
      <AnimatePresence initial={false}>
        {points
          .slice(index, index + 2)
          .reverse()
          .map((p, revI, arr) => {
            const isTop = revI === arr.length - 1;
            const depth = arr.length - 1 - revI; // 0 for top card, 1 for the one behind
            return (
              <SwipeCard key={p.id} point={p} isTop={isTop} depth={depth} onChoose={onChoose} />
            );
          })}
      </AnimatePresence>
    </div>
  );
}

function SwipeCard({
  point,
  isTop,
  depth,
  onChoose,
}: {
  point: SpecPointWithConfidence;
  isTop: boolean;
  depth: number;
  onChoose: (choice: BandKey) => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const confidentOpacity = useTransform(x, [20, SWIPE_THRESHOLD], [0, 1]);
  const shakyOpacity = useTransform(x, [-SWIPE_THRESHOLD, -20], [1, 0]);

  return (
    <motion.div
      className="absolute inset-0"
      style={isTop ? { x, rotate } : undefined}
      initial={{ scale: 1 - depth * 0.05, y: depth * 10, opacity: depth === 0 ? 1 : 0.6 }}
      animate={{ scale: 1 - depth * 0.05, y: depth * 10, opacity: depth === 0 ? 1 : 0.6 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      drag={isTop ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDragEnd={(_, info) => {
        // Drag is a shortcut for the two extremes; the middle button covers amber.
        if (info.offset.x > SWIPE_THRESHOLD) onChoose("confident");
        else if (info.offset.x < -SWIPE_THRESHOLD) onChoose("shaky");
      }}
      whileTap={isTop ? { cursor: "grabbing" } : undefined}
    >
      <div className="h-full w-full rounded-2xl border border-border bg-card shadow-md p-5 flex flex-col select-none cursor-grab active:cursor-grabbing">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          {point.code}
        </span>
        <p className="mt-2 font-display text-lg font-semibold leading-snug flex-1 flex items-center">
          {point.title}
        </p>
        {isTop && (
          <p className="text-[11px] text-muted-foreground">
            Drag left/right, or use the buttons below.
          </p>
        )}
      </div>

      {isTop && (
        <>
          <motion.div
            style={{ opacity: confidentOpacity }}
            className="absolute top-5 right-5 rotate-12 rounded-lg border-2 border-emerald-500 px-2.5 py-1 text-sm font-bold uppercase text-emerald-500"
          >
            Confident
          </motion.div>
          <motion.div
            style={{ opacity: shakyOpacity }}
            className="absolute top-5 left-5 -rotate-12 rounded-lg border-2 border-rose-500 px-2.5 py-1 text-sm font-bold uppercase text-rose-500"
          >
            Needs work
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
