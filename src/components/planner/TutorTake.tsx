import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquareQuote, ArrowRight, CalendarPlus, Sparkles } from "lucide-react";
import { WeeklyPlanDAL, type WeeklyPlan, type SpecPointLabel } from "@/lib/weeklyPlanDal";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { addWeeks, weekKeyToDate, toDateKey, weekRangeLabel } from "@/lib/week";
import { SpecPointSelect } from "@/components/tutor/SpecPointSelect";

/**
 * "Ali's take" — the personalized-tutoring heart of the week review. The tutor
 * writes how the student did and what to focus on next, and lines up the spec
 * points for next week; the panel previews exactly how that reshapes next week's
 * schedule, and the tutor can apply it in one click. The student sees the same
 * note read-only, so the plan always carries a human voice, not just the
 * algorithm's.
 *
 * `isTutor` (the review card's readOnly flag) switches between the editor and
 * the student's read-only view.
 */
export function TutorTake({
  studentId,
  plan,
  subject,
  board,
  level,
  weekStart,
  isTutor,
  onChanged,
}: {
  studentId: string;
  plan: WeeklyPlan;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  weekStart: string;
  isTutor: boolean;
  onChanged: () => void;
}) {
  const nextStart = useMemo(() => toDateKey(addWeeks(weekKeyToDate(weekStart), 1)), [weekStart]);
  const nextLabel = weekRangeLabel(addWeeks(weekKeyToDate(weekStart), 1));

  const [note, setNote] = useState("");
  const [nextPoints, setNextPoints] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "apply">(null);

  // Labels for read-only display + the "next week will look like this" preview.
  const [labels, setLabels] = useState<Map<string, SpecPointLabel>>(new Map());
  // What's already sitting in next week's plan, so the preview is the full picture.
  const [existingNext, setExistingNext] = useState<SpecPointLabel[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [tn, next] = await Promise.all([
        WeeklyPlanDAL.getTutorNote(plan.id),
        WeeklyPlanDAL.getPlan(studentId, subject, nextStart),
      ]);
      if (!alive) return;
      setNote(tn?.note ?? "");
      setSavedNote(tn?.note ?? null);
      setNextPoints(tn?.next_points ?? []);
      setExistingNext(
        (next?.points ?? []).map((p) => ({ id: p.spec_point_id, code: p.code, title: p.title })),
      );
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [plan.id, studentId, subject, nextStart]);

  // Resolve labels for whatever points are referenced (tutor's picks + existing).
  useEffect(() => {
    const ids = [...new Set([...nextPoints, ...existingNext.map((p) => p.id)])];
    if (ids.length === 0) {
      setLabels(new Map());
      return;
    }
    let alive = true;
    WeeklyPlanDAL.getSpecPointLabels(ids).then((rows) => {
      if (!alive) return;
      setLabels(new Map(rows.map((r) => [r.id, r])));
    });
    return () => {
      alive = false;
    };
  }, [nextPoints, existingNext]);

  // The resulting next-week focus = what's already there ∪ the tutor's new picks.
  const preview = useMemo(() => {
    const existingIds = new Set(existingNext.map((p) => p.id));
    const merged = [...existingNext];
    for (const id of nextPoints) {
      if (!existingIds.has(id)) {
        const l = labels.get(id);
        merged.push({ id, code: l?.code ?? "…", title: l?.title ?? "" });
      }
    }
    return merged;
  }, [existingNext, nextPoints, labels]);

  const saveNote = async () => {
    setBusy("save");
    try {
      await WeeklyPlanDAL.saveTutorNote({
        planId: plan.id,
        studentId,
        note: note.trim() || null,
        nextPoints,
      });
      setSavedNote(note.trim() || null);
      toast.success("Saved your take.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setBusy(null);
    }
  };

  const applyToNextWeek = async () => {
    if (nextPoints.length === 0) {
      toast.info("Pick the spec points to line up for next week first.");
      return;
    }
    setBusy("apply");
    try {
      // Save the take, then merge the picks into next week's plan (creating it if
      // there isn't one yet) so the change is real, not just a suggestion.
      await WeeklyPlanDAL.saveTutorNote({
        planId: plan.id,
        studentId,
        note: note.trim() || null,
        nextPoints,
      });
      const existing = await WeeklyPlanDAL.getPlan(studentId, subject, nextStart);
      if (existing) {
        await WeeklyPlanDAL.addPoints(existing.plan.id, nextPoints, "tutor");
      } else {
        await WeeklyPlanDAL.savePlan({
          subject,
          board,
          level,
          weekStart: nextStart,
          specPointIds: nextPoints,
          source: "tutor",
          origin: "tutor",
          studentId,
        });
      }
      setSavedNote(note.trim() || null);
      const next = await WeeklyPlanDAL.getPlan(studentId, subject, nextStart);
      setExistingNext(
        (next?.points ?? []).map((p) => ({ id: p.spec_point_id, code: p.code, title: p.title })),
      );
      toast.success(`Lined up ${nextPoints.length} for ${nextLabel}.`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update next week — try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!loaded) {
    return (
      <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---- Student's read-only view -------------------------------------------
  if (!isTutor) {
    if (!savedNote && existingNext.length === 0) return null;
    return (
      <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-2.5">
          <MessageSquareQuote className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Ali's take</h3>
        </div>
        {savedNote ? (
          <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
            {savedNote}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Your tutor lined up next week for you.</p>
        )}
        {existingNext.length > 0 && (
          <div className="mt-3 pt-3 border-t border-primary/15">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">
              What Ali lined up for {nextLabel}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {existingNext.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-card border border-border text-[11px]"
                >
                  <span className="font-semibold text-muted-foreground">{p.code}</span>
                  <span className="truncate max-w-[10rem]">{p.title}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- Tutor's editor ------------------------------------------------------
  return (
    <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/[0.03] p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquareQuote className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Ali's take</h3>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">
          Tutor
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        How did they do, and what should they focus on next week? The student sees this.
      </p>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="e.g. Really strong on limiting factors — 100% on the quiz. Xylem vs phloem is still shaky, so let's give transport another week before moving on."
        className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
      />

      <div className="mt-3">
        <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">
          Line up next week's focus ({nextLabel})
        </p>
        <SpecPointSelect
          subject={subject}
          board={board}
          level={level}
          value={nextPoints}
          onChange={setNextPoints}
        />
      </div>

      {/* Preview: how next week's schedule ends up */}
      <div className="mt-3 rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <p className="text-[11px] font-semibold">
            {nextLabel} will focus on {preview.length} {preview.length === 1 ? "topic" : "topics"}
          </p>
        </div>
        {preview.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing lined up yet — pick some points above.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {preview.map((p) => {
              const isNew = !existingNext.some((e) => e.id === p.id);
              return (
                <span
                  key={p.id}
                  className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[11px] ${
                    isNew
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-muted/40 border-border text-muted-foreground"
                  }`}
                >
                  <span className="font-semibold">{p.code}</span>
                  <span className="truncate max-w-[9rem]">{p.title}</span>
                  {isNew && <span className="text-[9px] font-bold uppercase">new</span>}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={saveNote}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
        >
          {busy === "save" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <MessageSquareQuote className="w-4 h-4" />
          )}
          Save note
        </button>
        <button
          type="button"
          onClick={applyToNextWeek}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {busy === "apply" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CalendarPlus className="w-4 h-4" />
          )}
          Apply to next week
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
