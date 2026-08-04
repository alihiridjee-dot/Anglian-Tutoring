import { useEffect, useMemo, useState, type DragEvent as ReactDragEvent } from "react";
import { AnimatePresence } from "motion/react";
import { Loader2, Layers, Info } from "lucide-react";
import { PlannerDAL, type TopicWithConfidence } from "@/lib/plannerDal";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { BANDS, bandOf, type BandKey } from "@/lib/planner/bands";
import { TopicCard } from "./TopicCard";
import { SpecPointSwipeModal } from "./SpecPointSwipeModal";

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

/**
 * The termly planner's confidence board. The student sorts each topic group into
 * a confidence band (drag between columns) — that band is their own read of the
 * topic, and seeds the FSRS cards underneath it.
 *
 * The column is what they *said*; the ring on each card is what the engine
 * *measures* (see `masteryByTopic`). Those are different questions and the board
 * shows both, but it never shows a second, invented number for the same thing —
 * when the plan has a mastery for a topic, that is the number on the card. Expanding a group lets them rate its individual spec points on the
 * same red/amber/green scale; those ratings are a finer FSRS signal layered
 * underneath and don't move the topic between columns (they only seed the column
 * when the topic hasn't been sorted at all yet).
 */
export function PlannerBoard({
  studentId,
  enrolments,
  level,
  subject,
  masteryByTopic,
  onChanged,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  /** When set, the subject is controlled by the parent and the tabs are hidden. */
  subject?: string;
  /**
   * Topic id → the mastery the plan uses. Supplied by a parent that has already
   * loaded the roadmap, so the card ring and the plan quote one number instead of
   * two. Omitted (a board with no plan beside it) → the ring falls back to the
   * student's own rating.
   */
  masteryByTopic?: Map<string, number>;
  /** Fires after a confidence write lands, so siblings (the roadmap) can reload. */
  onChanged?: () => void;
}) {
  // Biology first, then whatever else the student takes.
  const ordered = useMemo(() => {
    const bio = enrolments.filter((e) => e.subject === "biology");
    const rest = enrolments.filter((e) => e.subject !== "biology");
    return [...bio, ...rest];
  }, [enrolments]);

  const [pickedSubject, setPickedSubject] = useState<string>(ordered[0]?.subject ?? "biology");
  const activeSubject = subject ?? pickedSubject;
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];

  const [topics, setTopics] = useState<TopicWithConfidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overBand, setOverBand] = useState<BandKey | "unsorted" | null>(null);
  const [modalTopic, setModalTopic] = useState<TopicWithConfidence | null>(null);

  // Named separately so the effect can depend on the two values it actually
  // uses. Depending on `active` itself would re-fetch whenever the enrolments
  // query hands back a fresh object for the same course.
  const activeBoard = active?.board;
  const activeCourseSubject = active?.subject;

  useEffect(() => {
    if (!activeBoard || !activeCourseSubject) return;
    let alive = true;
    setLoading(true);
    PlannerDAL.getTopicsWithConfidence(
      studentId,
      level,
      activeBoard as BoardV,
      activeCourseSubject as SubjectV,
    )
      .then((t) => alive && setTopics(t))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [studentId, level, activeBoard, activeCourseSubject]);

  const unsorted = topics.filter((t) => t.confidence == null);
  const byBand = (key: BandKey) =>
    topics
      .filter((t) => t.confidence != null && bandOf(t.confidence).key === key)
      .sort((a, b) => a.sort_index - b.sort_index || a.sort_order - b.sort_order);

  const dropInto = async (key: BandKey, e: ReactDragEvent) => {
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setOverBand(null);
    if (!id) return;
    const target = topics.find((t) => t.id === id);
    const midpoint = BANDS.find((b) => b.key === key)!.midpoint;
    if (!target || target.confidence === midpoint) return;

    setTopics((prev) => prev.map((t) => (t.id === id ? { ...t, confidence: midpoint } : t)));
    try {
      // Dragging a whole topic re-rates every spec point beneath it, so the
      // FSRS cards (and the programme roadmap) move with the board.
      await PlannerDAL.setTopicConfidence(id, midpoint, undefined, true);
      onChanged?.();
    } catch (e) {
      console.error("set topic confidence", e);
    }
  };

  const applyAggregate = async (topicId: string, mean: number | null) => {
    // `mean` is non-null only when the topic was unsorted and these point ratings
    // seed its column; when it already has a column we leave it put. Either way
    // the per-point ratings just advanced FSRS cards, so the plan must re-flow —
    // always signal `onChanged`, even when the column itself didn't move.
    if (mean != null) {
      setTopics((prev) => prev.map((t) => (t.id === topicId ? { ...t, confidence: mean } : t)));
      try {
        await PlannerDAL.setTopicConfidence(topicId, mean);
      } catch (e) {
        console.error("apply aggregate", e);
      }
    }
    onChanged?.();
  };

  const ratedCount = topics.filter((t) => t.confidence != null).length;

  if (!active) {
    return (
      <p className="text-sm text-muted-foreground">
        You're not enrolled in any subjects yet — contact your tutor to get set up.
      </p>
    );
  }

  return (
    <div>
      {/* Subject tabs (hidden when the parent controls the subject) + progress */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          {subject == null &&
            ordered.map((e) => (
              <button
                key={e.subject}
                type="button"
                onClick={() => setPickedSubject(e.subject)}
                className={`h-8 px-3 rounded-lg text-sm font-medium transition ${
                  e.subject === activeSubject
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {subjectLabel[e.subject] ?? e.subject}
              </button>
            ))}
        </div>
        {!loading && topics.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {ratedCount} of {topics.length} topics sorted
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : topics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No curriculum topics are set up for {subjectLabel[active.subject] ?? active.subject} (
          {active.board.toUpperCase()}) yet.
        </div>
      ) : (
        <>
          {/* Unsorted tray */}
          {unsorted.length > 0 && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setOverBand("unsorted");
              }}
              onDragLeave={() => setOverBand((b) => (b === "unsorted" ? null : b))}
              className={`mb-5 rounded-2xl border p-3 transition ${
                overBand === "unsorted"
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="flex items-center gap-2 mb-2 px-1">
                <Layers className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Not sorted yet</h3>
                <span className="text-xs text-muted-foreground">
                  Drag each into a column below, or tap to rate its points
                </span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {unsorted.map((t) => (
                  <TopicCard
                    key={t.id}
                    topic={t}
                    mastery={masteryByTopic?.get(t.id) ?? null}
                    dragging={draggingId === t.id}
                    onDragStart={(id) => setDraggingId(id)}
                    onDragEnd={() => setDraggingId(null)}
                    onOpen={() => setModalTopic(t)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Confidence columns */}
          <div className="grid md:grid-cols-3 gap-3">
            {BANDS.map((band) => {
              const cards = byBand(band.key);
              const isOver = overBand === band.key;
              return (
                <div
                  key={band.key}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverBand(band.key);
                  }}
                  onDragLeave={() => setOverBand((b) => (b === band.key ? null : b))}
                  onDrop={(e) => dropInto(band.key, e)}
                  className={`rounded-2xl border p-3 min-h-[160px] transition ${
                    isOver
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                      : "border-border bg-muted/20"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <span className={`w-2.5 h-2.5 rounded-full ${band.dot}`} />
                    <h3 className={`text-sm font-semibold ${band.accent}`}>{band.label}</h3>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {cards.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {cards.map((t) => (
                      <TopicCard
                        key={t.id}
                        topic={t}
                        mastery={masteryByTopic?.get(t.id) ?? null}
                        dragging={draggingId === t.id}
                        onDragStart={(id) => setDraggingId(id)}
                        onDragEnd={() => setDraggingId(null)}
                        onOpen={() => setModalTopic(t)}
                      />
                    ))}
                    {cards.length === 0 && (
                      <p className="text-xs text-muted-foreground/70 px-1 py-4 text-center">
                        Drop topics here
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Your plan isn't fixed — come back and re-sort any time. We use this to build your weekly
            plan and pick homework.
          </p>
        </>
      )}

      <AnimatePresence>
        {modalTopic && (
          <SpecPointSwipeModal
            studentId={studentId}
            topicId={modalTopic.id}
            topicTitle={modalTopic.title}
            topicCode={modalTopic.code}
            columnConfidence={modalTopic.confidence}
            onClose={() => setModalTopic(null)}
            onAggregate={(mean) => applyAggregate(modalTopic.id, mean)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
