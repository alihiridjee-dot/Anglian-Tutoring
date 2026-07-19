import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { X, Loader2, Check, ThumbsDown, ThumbsUp, Undo2, AlertTriangle } from "lucide-react";
import { PlannerDAL, type SpecPointWithConfidence } from "@/lib/plannerDal";
import { bandOf, type Band } from "@/lib/planner/bands";

/**
 * The "expand a topic group" view, reimagined as a Tinder-style swipe deck: one
 * card per spec point, swiped right for "Confident" or left for "Needs work".
 *
 * Each swipe is a binary self-report scored on the shared 0-100 confidence scale
 * (a soft split — see SWIPE_SCORE). When the deck is done we:
 *  • average each point's swipe with the score of the column the topic sits in
 *    and persist that per point — this is what feeds the FSRS engine;
 *  • hand the parent the mean so the card can settle into the matching band;
 *  • if the swipes as a whole disagree with the column the student dragged the
 *    topic into, ask whether they've filed it in the right place.
 */

// A deliberately soft split: a single deck should nudge, not slam, the schedule.
const SWIPE_SCORE = { confident: 75, shaky: 30 } as const;
const SWIPE_THRESHOLD = 110; // px of horizontal drag to commit a decision

type Choice = "confident" | "shaky";

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
  /** New topic-level confidence to settle the card into, or null if nothing rated. */
  onAggregate: (mean: number | null) => void;
}) {
  const [points, setPoints] = useState<SpecPointWithConfidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ swipeBand: Band; columnBand: Band; mean: number } | null>(
    null,
  );

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

  const columnBand = columnConfidence != null ? bandOf(columnConfidence) : null;

  // Persist every swipe as an averaged-with-column confidence (the FSRS feed),
  // then surface either the conflict prompt or hand the mean straight back.
  const finish = async (finalChoices: Record<string, Choice>) => {
    setSaving(true);
    const swipeScores = points.map((p) => SWIPE_SCORE[finalChoices[p.id] ?? "shaky"]);
    // Per point: the average of the swipe and the column it's filed under. With
    // no column yet, the swipe stands on its own.
    const persisted = points.map((p, i) =>
      columnConfidence == null
        ? swipeScores[i]
        : Math.round((swipeScores[i] + columnConfidence) / 2),
    );
    try {
      await Promise.all(
        points.map((p, i) => PlannerDAL.setSpecPointConfidence(p.id, persisted[i]).catch(() => {})),
      );
    } finally {
      setSaving(false);
    }

    const swipeMean = Math.round(swipeScores.reduce((s, n) => s + n, 0) / swipeScores.length);
    const persistedMean = Math.round(persisted.reduce((s, n) => s + n, 0) / persisted.length);
    const swipeBand = bandOf(swipeMean);

    // The swipes disagree with the column the student dragged the topic into —
    // check they've filed it in the right place before settling the card.
    if (columnBand && swipeBand.key !== columnBand.key) {
      setConflict({ swipeBand, columnBand, mean: swipeMean });
      return;
    }
    onAggregate(persistedMean);
    onClose();
  };

  const choose = (choice: Choice) => {
    const p = points[index];
    if (!p) return;
    const next = { ...choices, [p.id]: choice };
    setChoices(next);
    if (index + 1 >= total) finish(next);
    else setIndex((i) => i + 1);
  };

  // Arrow keys drive the deck: ← needs work, → confident (only while swiping).
  useEffect(() => {
    if (loading || done || conflict) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        choose("confident");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        choose("shaky");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, done, conflict, index, points]);

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

  // Resolve the conflict: move the card to what the swipes say, or keep it where
  // the student filed it (FSRS already has the averaged per-point scores either way).
  const resolveMove = () => {
    if (conflict) onAggregate(conflict.mean);
    onClose();
  };
  const resolveKeep = () => {
    onAggregate(columnConfidence);
    onClose();
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
              Swipe right if you're confident, left if it needs work.
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
          ) : conflict ? (
            <ConflictPrompt
              swipeBand={conflict.swipeBand}
              columnBand={conflict.columnBand}
              onMove={resolveMove}
              onKeep={resolveKeep}
            />
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
            <SwipeDeck
              points={points}
              index={index}
              onChoose={choose}
            />
          )}
        </div>

        {!loading && !conflict && !done && points.length > 0 && (
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => choose("shaky")}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-rose-500/40 text-rose-600 dark:text-rose-400 text-sm font-semibold hover:bg-rose-500/10"
              >
                <ThumbsDown className="w-4 h-4" /> Needs work
              </button>
              <button
                type="button"
                onClick={() => choose("confident")}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-sm font-semibold hover:bg-emerald-500/10"
              >
                <ThumbsUp className="w-4 h-4" /> Confident
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
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
  onChoose: (choice: Choice) => void;
}) {
  return (
    <div className="relative h-56">
      <AnimatePresence initial={false}>
        {points.slice(index, index + 2).reverse().map((p, revI, arr) => {
          const isTop = revI === arr.length - 1;
          const depth = arr.length - 1 - revI; // 0 for top card, 1 for the one behind
          return (
            <SwipeCard
              key={p.id}
              point={p}
              isTop={isTop}
              depth={depth}
              onChoose={onChoose}
            />
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
  onChoose: (choice: Choice) => void;
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
          <p className="text-[11px] text-muted-foreground">Drag or use the buttons below.</p>
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

function ConflictPrompt({
  swipeBand,
  columnBand,
  onMove,
  onKeep,
}: {
  swipeBand: Band;
  columnBand: Band;
  onMove: () => void;
  onKeep: () => void;
}) {
  return (
    <div className="py-4 text-center">
      <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
        <AlertTriangle className="w-6 h-6" />
      </div>
      <p className="mt-3 font-display text-base font-semibold">Are you sure about the column?</p>
      <p className="text-sm text-muted-foreground mt-1.5 px-2">
        Your answers look more like{" "}
        <span className={`font-semibold ${swipeBand.accent}`}>{swipeBand.label}</span>, but you filed
        this under <span className={`font-semibold ${columnBand.accent}`}>{columnBand.label}</span>.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          onClick={onMove}
          className="h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
        >
          Move to {swipeBand.label}
        </button>
        <button
          type="button"
          onClick={onKeep}
          className="h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted"
        >
          Keep in {columnBand.label}
        </button>
      </div>
    </div>
  );
}
