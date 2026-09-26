import { PLANNER_TIME_ZONE } from "@/lib/planner/week";
import {
  Loader2,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Target,
  Lock,
  Send,
  CircleDot,
  Repeat,
  Plus,
  MinusCircle,
} from "lucide-react";
import {
  verdictCopy,
  BREAKDOWN,
  LANE_LABEL,
  STATUS_STYLE,
  type Lane,
  type WeekSummary,
} from "@/lib/planner/coverage";
import { reviewLock } from "@/lib/planner/reviewLock";
import { type WeekReviewBusy } from "./useWeekReview";

/** The student's self-report: the two feel-buttons, and the note that goes to their tutor. */
export function WeeklyCheckinForm({
  coveredOk,
  busy,
  report,
  noteState,
  setNoteState,
  reflection,
  setReflection,
  saveNote,
}: {
  coveredOk: boolean | null;
  busy: WeekReviewBusy;
  report: (ok: boolean) => void;
  noteState: "idle" | "saving" | "sent";
  setNoteState: (state: "idle" | "saving" | "sent") => void;
  reflection: string;
  setReflection: (text: string) => void;
  saveNote: () => void;
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-muted-foreground mb-2">Your weekly check-in</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => report(true)}
          disabled={!!busy}
          className={`inline-flex items-center gap-1.5 h-11 sm:h-9 px-3.5 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${
            coveredOk === true ? "bg-emerald-600 text-white" : "border border-border hover:bg-muted"
          }`}
        >
          {busy === "confident" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          I've finished my work
        </button>
        <button
          type="button"
          onClick={() => report(false)}
          disabled={!!busy}
          className={`inline-flex items-center gap-1.5 h-11 sm:h-9 px-3.5 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${
            coveredOk === false ? "bg-amber-500 text-white" : "border border-border hover:bg-muted"
          }`}
        >
          {busy === "practice" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Target className="w-4 h-4" />
          )}
          I'd like help or more practice
        </button>
      </div>

      {/* The note goes to a person, and says so. */}
      <div className="mt-3.5 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Send className="w-3.5 h-3.5 text-primary" />
          <p className="text-xs font-semibold">Message your tutor about this week</p>
          {noteState === "saving" && (
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />
          )}
          {noteState === "sent" && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" /> Sent to your tutor
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mb-2">
          Ali reads this alongside your marks and replies here as "Ali's take".
        </p>
        <textarea
          value={reflection}
          onChange={(e) => {
            setReflection(e.target.value);
            if (noteState === "sent") setNoteState("idle");
          }}
          onBlur={saveNote}
          rows={2}
          aria-label="Message your tutor about this week"
          placeholder="e.g. I got stuck on the meiosis diagram questions — could we go over them?"
          className="w-full rounded-lg premium-input px-3 py-2 text-sm resize-none"
        />
      </div>
    </div>
  );
}

/** Carries whatever is still loose into next week. */
export function CarryForwardBar({
  count,
  busy,
  nextWeekLabel,
  onCarry,
}: {
  count: number;
  busy: WeekReviewBusy;
  nextWeekLabel: string;
  onCarry: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-border/60">
      <button
        type="button"
        onClick={onCarry}
        disabled={!!busy}
        className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-3.5 rounded-lg btn-solid text-sm font-semibold hover:opacity-90 disabled:opacity-50"
      >
        {busy === "carry" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ArrowRight className="w-4 h-4" />
        )}
        Carry {count} into next week
      </button>
      <span className="text-[11px] text-muted-foreground">
        An explicit request for extra practice in {nextWeekLabel}; normal reviews follow their
        scheduled dates.
      </span>
    </div>
  );
}

const LANE_ICON: Record<Lane, typeof CircleDot> = {
  core: CircleDot,
  focus: Repeat,
  yours: Plus,
};

const LANE_ACCENT: Record<Lane, string> = {
  core: "text-primary",
  focus: "text-rose-600 dark:text-rose-400",
  yours: "text-muted-foreground",
};

/** One lane's verdict and tally — the same anatomy for all three. */
export function LaneReview({
  lane,
  summary,
  readOnly,
  pointCount,
}: {
  lane: Lane;
  summary: WeekSummary;
  readOnly: boolean;
  pointCount: number;
}) {
  const copy = verdictCopy(summary.verdict, summary);
  const Icon = LANE_ICON[lane];
  const headline = readOnly ? tutorHeadline(summary) : copy.headline;
  const sub = readOnly
    ? "Based on this week's homework and quiz marks on these spec points."
    : copy.sub;

  return (
    <div className={`rounded-xl border p-3.5 ${copy.tone}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`w-3.5 h-3.5 ${LANE_ACCENT[lane]}`} />
        <span className={`text-[10px] font-bold uppercase tracking-wide ${LANE_ACCENT[lane]}`}>
          {LANE_LABEL[lane]}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {pointCount} {pointCount === 1 ? "point" : "points"}
        </span>
      </div>
      <div className="flex items-start gap-2.5">
        {summary.verdict === "move_on" ? (
          <CheckCircle2 className={`w-5 h-5 mt-0.5 shrink-0 ${copy.accent}`} />
        ) : summary.verdict === "no_signal" ? (
          <MinusCircle className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <RotateCcw className={`w-5 h-5 mt-0.5 shrink-0 ${copy.accent}`} />
        )}
        <div>
          <p className={`text-sm font-semibold ${copy.accent}`}>{headline}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        </div>
      </div>
      <CoverageBar summary={summary} />
    </div>
  );
}

/**
 * The lane's spec points as one bar, then a line per band explaining itself.
 *
 * The bar carries the shape of the week at a glance — how much is green, how
 * much isn't — and the key underneath carries the meaning, because a bare tally
 * reading "1 Practised" only makes sense to whoever wrote the rule. Bands with a
 * count of zero are left out entirely: a row of noughts is noise, and it was the
 * reason the old card led with "0 Nailed 0 Practised 0 Shaky".
 */
function CoverageBar({ summary }: { summary: WeekSummary }) {
  const bands = BREAKDOWN.map((b) => ({
    status: b.status,
    n: b.count(summary),
    ...STATUS_STYLE[b.status],
  })).filter((b) => b.n > 0);
  if (bands.length === 0) return null;
  const total = Math.max(1, summary.total);

  return (
    <div className="mt-3 pt-3 border-t border-border/60">
      <div className="flex h-2.5 gap-0.5 rounded-full overflow-hidden bg-muted/60">
        {bands.map((b) => (
          <div
            key={b.status}
            className={b.dot}
            style={{ width: `${(b.n / total) * 100}%` }}
            title={`${b.n} ${b.label} — ${b.meaning}`}
          />
        ))}
      </div>
      <ul className="mt-2.5 space-y-1">
        {bands.map((b) => (
          <li key={b.status} className="flex items-center gap-2 text-[11px] leading-tight">
            <span className={`w-2 h-2 rounded-full shrink-0 ${b.dot}`} />
            <span className="font-bold tabular-nums">{b.n}</span>
            <span className="font-semibold">{b.label}</span>
            <span className="text-muted-foreground truncate">— {b.meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The same objective read, framed for the tutor rather than encouragingly. */
function tutorHeadline(s: WeekSummary): string {
  switch (s.verdict) {
    case "no_signal":
      return "No homework or quizzes set on these points";
    case "move_on":
      return "On track — all planned points covered";
    case "almost":
      return "Mostly covered — a few points to revisit";
    default:
      return "Needs work — points still shaky or not done";
  }
}

/**
 * Why the review is shut, and what opens it.
 *
 * Deliberately specific: "opens Sunday" alone reads as an arbitrary gate, while
 * "two homeworks left" is a thing the student can act on this afternoon.
 */
export function LockedCard({ lock }: { lock: ReturnType<typeof reviewLock> }) {
  const opens = lock.opensOn.toLocaleDateString(undefined, {
    timeZone: PLANNER_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  const outstanding = lock.homeworkTotal - lock.homeworkDone;
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
      <div className="flex items-start gap-2.5">
        <Lock className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Your week in review opens {opens}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lock.homeworkTotal === 0
              ? "There's still time left in this week, so there's nothing to sum up yet."
              : outstanding === 1
                ? "One homework still to hand in — finish it and this opens straight away."
                : `${outstanding} homeworks still to hand in — finish them and this opens straight away.`}
          </p>
        </div>
      </div>
      {lock.homeworkTotal > 0 && (
        <div className="mt-3 pt-3 border-t border-border/60">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-muted-foreground">Homework handed in</span>
            <span className="font-semibold tabular-nums">
              {lock.homeworkDone} of {lock.homeworkTotal}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${Math.max(2, Math.round((lock.homeworkDone / lock.homeworkTotal) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
