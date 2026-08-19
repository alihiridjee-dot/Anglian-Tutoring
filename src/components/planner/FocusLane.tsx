import { ChevronDown, HelpCircle, Repeat } from "lucide-react";
import { type PacingBand } from "@/lib/planner/pacing";
import { type TopicProgress } from "@/lib/scheduleDal";
import { PointRow, BarePointRow } from "./PointRow";
import { FOCUSED_TOPICS_BLURB, FOCUS_TONES, FOCUS_TONE_ORDER, focusTone } from "./focusMeta";

/**
 * The focus lane of the full-plan table — the column of topics the memory engine
 * keeps bringing back, and everything that hangs off it.
 *
 * It lives here rather than in either plan table because there are two of those
 * (the student's "Full plan" tab and the roadmap panel reused on the dashboards
 * and the tutor's view) showing the same lane, and they had drifted: same idea,
 * two sets of markup. One copy means a change to how focus reads lands on every
 * surface at once.
 *
 * The anatomy deliberately mirrors the core column: a topic you can open to see
 * the spec points underneath it. Core and focus are the same kind of thing —
 * work with a name and a list of points — differing only in *why* they're on the
 * list, so they shouldn't ask to be read two different ways.
 */

/**
 * The "Focused topics" column header, with the explanation a hover away.
 *
 * The whole plan hinges on the student understanding why a topic they already
 * covered is sitting on next week's row. The legend above the table says it
 * once, but the header is where they're looking at the moment they wonder.
 */
export function FocusedTopicsHeaderCell() {
  return (
    <div className="px-3 py-2 border-l border-border">
      <FocusedTopicsLabel />
    </div>
  );
}

/**
 * "Focused topics" wherever it's used as a heading, with the blurb behind the
 * question mark beside it.
 *
 * The blurb hangs off the *icon* alone, not the whole heading: a tooltip that
 * fires whenever the pointer crosses the column title would cover the first row
 * of the table every time the student went to click something in it.
 *
 * `className` carries the host's own type treatment, so the label still reads as
 * part of the card or table header it sits in. The tooltip opens leftwards so it
 * stays inside the panel wherever the heading sits.
 */
export function FocusedTopicsLabel({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Repeat className="w-3.5 h-3.5 text-rose-500 shrink-0" />
      Focused topics
      <span
        className="group/help relative inline-flex shrink-0 cursor-help"
        tabIndex={0}
        aria-label="What are focused topics?"
      >
        <HelpCircle className="w-3 h-3 opacity-60" />
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 w-64 rounded-lg border border-border bg-popover p-2.5 text-[11px] font-normal normal-case tracking-normal leading-relaxed text-muted-foreground shadow-lg opacity-0 transition-opacity group-hover/help:opacity-100 group-focus/help:opacity-100"
        >
          {FOCUSED_TOPICS_BLURB}
        </span>
      </span>
    </span>
  );
}

/**
 * The colour key for the focus lane, so the shading means something.
 *
 * Three swatches and three words. Each swatch is the row in miniature — same
 * tint, same coloured left edge — so the mapping needs no explaining, and the
 * sentence behind each one waits on hover rather than taking a line of the page.
 * Spelling all three out in full turned a legend into a paragraph, which is the
 * opposite of what a legend is for.
 *
 * Sits above the table, not under it: a key you meet after reading the rows has
 * arrived too late to be a key.
 */
export function FocusKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {FOCUS_TONE_ORDER.map((name) => {
        const tone = FOCUS_TONES[name];
        return (
          <span
            key={name}
            className="inline-flex items-center gap-1.5 cursor-help"
            title={tone.meaning}
          >
            <span className={`w-3.5 h-3.5 rounded-sm border border-l-[3px] ${tone.swatch}`} />
            {tone.label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * One focused topic in a week's cell, shaded by why it came back: red for a
 * topic a long way off, amber for one due a review, green for a light refresh.
 *
 * The reason used to ride in a text chip beside the title, which pushed the
 * topic itself into an ellipsis in a column this narrow and made every row look
 * equally urgent. As shading it costs no width, and a week's worth of rows can
 * be read as a block. What's left is the topic, the icon, and — when there are
 * spec points behind it — the same chevron the core column uses.
 */
export function FocusTopicButton({
  band,
  mastery,
  isNew = false,
  hasDetail,
  open,
  onToggle,
}: {
  band: PacingBand;
  mastery: number;
  /** Flags a slot the latest ratings just moved or added. */
  isNew?: boolean;
  hasDetail: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const tone = focusTone(band, mastery);
  const Icon = tone.icon;
  return (
    <button
      type="button"
      onClick={() => hasDetail && onToggle()}
      title={`${tone.label} — ${tone.why}`}
      className={`w-full text-left min-w-0 rounded-md border-l-[3px] px-2 py-1.5 transition-colors ${
        tone.row
      } ${hasDetail ? "" : "cursor-default"}`}
      aria-expanded={hasDetail ? open : undefined}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon className={`w-3 h-3 shrink-0 ${tone.iconCls}`} />
        <span className="sr-only">{tone.label}: </span>
        <span className="text-[12px] font-medium truncate">{band.title}</span>
        {isNew && (
          <span className="inline-flex items-center h-4 px-1 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[9px] font-bold uppercase tracking-wide shrink-0">
            New
          </span>
        )}
        {hasDetail && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground shrink-0 ml-auto transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </div>
    </button>
  );
}

/**
 * An open focused topic's spec points, laid out like the core topic's breakdown
 * — including the "show the whole topic" escape hatch, so a student revisiting
 * three points can still see what else the topic holds.
 */
export function FocusPointsPanel({
  band,
  progress,
  wholeTopic,
  onToggleWholeTopic,
}: {
  band: PacingBand;
  progress: TopicProgress | undefined;
  wholeTopic: boolean;
  onToggleWholeTopic: () => void;
}) {
  const all = progress?.points ?? [];
  const refs = band.points ?? [];
  const byId = new Map(all.map((p) => [p.id, p]));
  // A revisit band names the weak points it brought back; a review band is the
  // whole topic taken lightly, so the topic's own list is the honest answer.
  const showingAll = wholeTopic || refs.length === 0;
  const rows = showingAll
    ? all.map((p) => ({ point: p, ref: null }))
    : refs.map((r) => ({ point: byId.get(r.specPointId) ?? null, ref: r }));
  if (rows.length === 0) return null;
  const partial = refs.length > 0 && refs.length < all.length;
  return (
    <div className="bg-rose-500/[0.04] px-4 py-2.5 border-t border-border">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          <span className="text-rose-600 dark:text-rose-400">{band.title}</span> ·{" "}
          {showingAll
            ? `Whole topic · ${rows.length} spec ${rows.length === 1 ? "point" : "points"}`
            : `Coming back round · ${rows.length}${partial ? ` of ${all.length}` : ""} spec ${
                rows.length === 1 ? "point" : "points"
              }`}
        </span>
        {partial && (
          <button
            type="button"
            onClick={onToggleWholeTopic}
            className="text-[10px] font-semibold text-primary hover:underline shrink-0"
          >
            {wholeTopic ? "Show what's due only" : "Show whole topic"}
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {rows.map(({ point, ref }) =>
          point ? (
            <PointRow key={point.id} point={point} />
          ) : ref ? (
            <BarePointRow key={ref.specPointId} code={ref.code} title={ref.title} />
          ) : null,
        )}
      </ul>
    </div>
  );
}
