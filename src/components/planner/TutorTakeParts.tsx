import {
  Loader2,
  MessageSquareQuote,
  ArrowRight,
  CalendarPlus,
  Sparkles,
  Wand2,
  CalendarRange,
} from "lucide-react";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { SpecPointSelect } from "@/components/tutor/SpecPointSelect";
import { type TutorTakeState } from "./useTutorTake";

/** What the student sees: the tutor's note, and what was lined up for next week. */
export function TutorTakeReadOnly({ take }: { take: TutorTakeState }) {
  const { savedNote, existingNext, nextLabel } = take;
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
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md premium-card text-[11px]"
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

/** Section 1 · Feedback for the student. */
export function TutorFeedbackEditor({
  take,
  studentReflection,
  studentFeltReady,
}: {
  take: TutorTakeState;
  studentReflection: string | null;
  studentFeltReady: boolean | null;
}) {
  const { hasCheckin, mode, setMode, draftWithAI, drafting, busy, note, setNote, saveNote } = take;
  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/[0.03] p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquareQuote className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Feedback for the student</h3>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">
          Tutor
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        How did they do this week? The student sees this note on their planner.
      </p>

      {/* The student's own check-in, quoted, so the tutor can reply to it */}
      {hasCheckin && (
        <div className="mb-3 rounded-xl premium-card p-3">
          <p className="text-[11px] font-semibold text-muted-foreground mb-1">The student said</p>
          <p className="text-sm">
            {studentFeltReady == null
              ? "—"
              : studentFeltReady
                ? "✅ Felt confident to move on"
                : "🎯 Wanted more practice"}
            {studentReflection && (
              <span className="block text-muted-foreground mt-1">“{studentReflection}”</span>
            )}
          </p>
        </div>
      )}

      {/* Dual mode: reply to the student's check-in, or write independently */}
      {hasCheckin && (
        <div className="mb-3">
          <div className="inline-flex rounded-lg premium-card p-0.5">
            {(["reply", "general"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`h-7 px-3 rounded-md text-xs font-semibold transition ${
                  mode === m ? "btn-solid" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "reply" ? "Reply to student" : "General feedback"}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {mode === "reply"
              ? "Responds directly to what the student wrote in their check-in."
              : "Standalone feedback, independent of the student's check-in."}
          </p>
        </div>
      )}

      {/* Draft with AI — grounds the note in the week's real marks + check-in */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-muted-foreground">Your note</p>
        <button
          type="button"
          onClick={draftWithAI}
          disabled={drafting || !!busy}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-primary/30 bg-primary/5 text-primary text-[11px] font-semibold hover:bg-primary/10 disabled:opacity-50"
          title="Draft feedback from this week's homework and quiz marks"
        >
          {drafting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Wand2 className="w-3.5 h-3.5" />
          )}
          Draft with AI
        </button>
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        placeholder="e.g. Really strong on limiting factors — 100% on the quiz. Xylem vs phloem is still shaky, so let's give transport another week before moving on."
        className="w-full rounded-lg premium-input px-3 py-2 text-sm resize-none"
      />

      <div className="mt-3">
        <button
          type="button"
          onClick={saveNote}
          disabled={!!busy || drafting}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg btn-solid text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {busy === "save" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <MessageSquareQuote className="w-4 h-4" />
          )}
          Save &amp; share with student
        </button>
      </div>
    </div>
  );
}

/** Section 2 · Assign spec points to an upcoming week. */
export function NextWeekAssigner({
  take,
  subject,
  board,
  level,
}: {
  take: TutorTakeState;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
}) {
  const {
    nextLabel,
    thisLabel,
    nextPoints,
    setNextPoints,
    preview,
    existingNext,
    applyToNextWeek,
    busy,
  } = take;
  return (
    <div className="rounded-2xl premium-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1">
        <CalendarRange className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Assign to {nextLabel}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Line up next week's focus. This writes to the plan for{" "}
        <span className="font-medium text-foreground">{nextLabel}</span> — separate from{" "}
        <span className="font-medium text-foreground">{thisLabel}</span> above.
      </p>

      <SpecPointSelect
        subject={subject}
        board={board}
        level={level}
        value={nextPoints}
        onChange={setNextPoints}
      />

      {/* Preview: how next week's schedule ends up */}
      <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
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

      <div className="mt-3">
        <button
          type="button"
          onClick={applyToNextWeek}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg btn-solid text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {busy === "apply" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CalendarPlus className="w-4 h-4" />
          )}
          Assign to {nextLabel}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
