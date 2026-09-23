import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Clock, Pause, Undo2 } from "lucide-react";
import { EmptyState, ErrorNote, SegmentedToggle, Spinner } from "@/components/Shared";
import { useOutgoingHomework } from "@/hooks/data/useOutgoingHomework";
import { useWindowedRows } from "@/hooks/useWindowedRows";
import { SUBJECT_TINT } from "@/lib/subjectTheme";
import { cn } from "@/lib/utils";
import {
  facetLabel,
  facetsFor,
  matchesSheetFilters,
  parseSet,
  segmentOf,
  sheetFlags,
  sortForReview,
  timeLeft,
  toggleInCsv,
  type FacetKey,
  type GradesSearch,
  type Sheet,
  type SheetFlag,
  type SheetSegment,
  type SheetStatus,
} from "@/lib/homeworkReview";
import { FilterChips } from "./FilterChips";
import { SheetPanel } from "./SheetPanel";

/**
 * Outgoing homework: generated sheets waiting at the tutor's gate.
 *
 * A table, not a board. The only move here is "approve" (or, rarely, "hold"),
 * and columns of cards would spend the screen showing that one transition.
 * Density is the feature: forty-odd rows on a laptop, filtered in memory so a
 * toggle answers in the same frame, driven from the keyboard end to end.
 *
 * A row is a *sheet*, not a student's copy of one — homework is written once
 * per spec point and shared, so reading one row is reading it for everybody.
 */

const ROW_HEIGHT = 44;
const COLUMNS =
  "grid grid-cols-[2rem_minmax(0,2.2fr)_6rem_5.5rem_6rem_minmax(0,1.8fr)_3rem_3.5rem_minmax(0,1fr)_6rem] items-center gap-x-3 px-3";

/** "Live" is a tab, not a flag: every row under it would carry the same chip. */
const FLAG: Record<Exclude<SheetFlag, "live">, { label: string; tint: string; title: string }> = {
  thin: { label: "Short", tint: "tint-amber", title: "Fewer than three questions" },
  answered: { label: "Answered", tint: "tint-slate", title: "Work has already been handed in" },
};

const FACETS: { key: FacetKey; label: string }[] = [
  { key: "subject", label: "Subject" },
  { key: "level", label: "Level" },
  { key: "tier", label: "Tier" },
  { key: "board", label: "Board" },
];

export function OutgoingReview({
  userId,
  search,
  setSearch,
}: {
  userId: string | null;
  search: GradesSearch;
  setSearch: (changes: Partial<GradesSearch>) => void;
}) {
  const { sheets, isLoading, error, refetch, setStatus, restore, prefetch, refreshCounts } =
    useOutgoingHomework(userId);
  const segment: SheetSegment = search.sheets ?? "upcoming";
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);

  // Filters first, status second — so each status tab counts what the filters
  // leave, and the numbers on screen always describe the table under them.
  const filtered = useMemo(
    () => sheets.filter((s) => matchesSheetFilters(s, search)),
    [sheets, search],
  );
  const unread = segment === "upcoming" || segment === "live";
  const rows = useMemo(() => {
    const inSegment = filtered.filter((s) => segmentOf(s) === segment);
    return unread
      ? sortForReview(inSegment)
      : inSegment.sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""));
  }, [filtered, segment, unread]);
  const countOf = (seg: SheetSegment) => filtered.filter((s) => segmentOf(s) === seg).length;

  const windowed = useWindowedRows<HTMLDivElement>(rows.length, ROW_HEIGHT);
  const openIndex = rows.findIndex((s) => s.id === search.sheet);
  const open = openIndex >= 0 ? rows[openIndex] : undefined;

  // A selection describes rows on screen; once the rows change it means nothing.
  useEffect(
    () => setPicked(new Set()),
    [segment, search.subject, search.level, search.tier, search.board],
  );
  useEffect(() => setCursor((c) => Math.min(c, Math.max(0, rows.length - 1))), [rows.length]);

  const decide = useCallback(
    async (ids: string[], status: SheetStatus) => {
      if (ids.length === 0) return;
      try {
        const before = await setStatus(ids, status);
        setPicked(new Set());
        const verb = status === "approved" ? "Approved" : status === "held" ? "Held" : "Sent back";
        toast.success(`${verb} ${before.size} ${before.size === 1 ? "sheet" : "sheets"}`, {
          action: { label: "Undo", onClick: () => void restore(before) },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update the sheets");
      }
    },
    [setStatus, restore],
  );

  /** Decide the open sheet and move the panel to the one after it. */
  const decideAndAdvance = useCallback(
    (status: SheetStatus) => {
      if (!open) return;
      const next = rows[openIndex + 1] ?? rows[openIndex - 1];
      setSearch({ sheet: next?.id });
      void decide([open.id], status);
    },
    [open, openIndex, rows, setSearch, decide],
  );

  useEffect(() => {
    if (open) prefetch(rows[openIndex + 1]?.id);
  }, [open, openIndex, rows, prefetch]);

  // Keyboard: J/K move, X ticks, A approves, H holds, Enter opens, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest("input, textarea, select, [contenteditable]");
      // Escape closes the panel from anywhere, including mid-edit: leaving the
      // field is what saves it. First press leaves the field, second closes.
      if (e.key === "Escape" && open) {
        if (typing) target?.blur();
        else setSearch({ sheet: undefined });
        e.preventDefault();
        return;
      }
      if (typing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const move = (delta: number) => {
        const next = Math.min(rows.length - 1, Math.max(0, (open ? openIndex : cursor) + delta));
        setCursor(next);
        windowed.scrollToRow(next);
        if (open) setSearch({ sheet: rows[next]?.id });
      };
      const targets = picked.size ? [...picked] : rows[cursor] ? [rows[cursor].id] : [];
      // With the panel open a decision also advances it; from the table it
      // applies to the ticked rows, or the row under the cursor.
      const act = (status: SheetStatus) =>
        open ? decideAndAdvance(status) : void decide(targets, status);
      // Enter on a focused button belongs to that button.
      const onControl = !!target?.closest("button, a");
      if (key === "j") move(1);
      else if (key === "k") move(-1);
      else if (key === "e" || (key === "enter" && !onControl))
        setSearch({ sheet: rows[cursor]?.id });
      else if (key === "x" && rows[cursor]) togglePick(rows[cursor].id);
      else if (key === "a" && segment !== "approved") act("approved");
      else if (key === "h" && segment !== "held") act("held");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = rows.length > 0 && rows.every((s) => picked.has(s.id));

  if (isLoading) return <Spinner label="Loading homework" className="py-16" />;
  if (error) return <ErrorNote error={error} onRetry={() => void refetch()} />;
  if (sheets.length === 0)
    return (
      <EmptyState
        title="Nothing to review"
        body="Generated homework lands here before students see it."
        mascot="books"
      />
    );

  const nextPublish = segment === "upcoming" ? timeLeft(rows[0]?.publishAt ?? null) : null;
  const targets = picked.size ? rows.filter((s) => picked.has(s.id)) : rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedToggle
          label="Sheet status"
          layoutId="outgoing-status"
          value={segment}
          onChange={(v) => setSearch({ sheets: v as SheetSegment, sheet: undefined })}
          items={[
            {
              value: "upcoming",
              label: "Upcoming",
              count: countOf("upcoming"),
              tint: "tint-amber",
            },
            { value: "live", label: "Live, unread", count: countOf("live"), tint: "tint-rose" },
            { value: "held", label: "Held", count: countOf("held"), tint: "tint-slate" },
            {
              value: "approved",
              label: "Approved",
              count: countOf("approved"),
              tint: "tint-emerald",
            },
          ]}
        />
        {nextPublish && (
          <span className="chip tint-amber">
            <Clock className="size-3" /> Next publishes in {nextPublish}
          </span>
        )}
      </div>

      <div className="premium-card rounded-2xl p-4 space-y-2.5">
        {FACETS.map(({ key, label }) => (
          <FilterChips
            key={key}
            label={label}
            facets={facetsFor(sheets, search, key)}
            selected={parseSet(search[key])}
            onToggle={(value) =>
              setSearch({ [key]: toggleInCsv(search[key], value), sheet: undefined })
            }
          />
        ))}
      </div>

      <div className="premium-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <div
            className="min-w-[68rem]"
            role="table"
            aria-label="Homework sheets"
            aria-rowcount={rows.length}
          >
            <div
              role="row"
              className={cn(
                COLUMNS,
                "h-10 bg-muted/60 text-[11px] uppercase tracking-widest text-muted-foreground font-bold",
              )}
            >
              <input
                type="checkbox"
                aria-label="Select all shown"
                checked={allPicked}
                onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((s) => s.id)))}
              />
              <span role="columnheader">Sheet</span>
              <span role="columnheader">Subject</span>
              <span role="columnheader">Level</span>
              <span role="columnheader">Board</span>
              <span role="columnheader">Spec</span>
              <span role="columnheader" className="text-right">
                Qs
              </span>
              <span role="columnheader" className="text-right">
                Marks
              </span>
              <span role="columnheader">Flags</span>
              <span role="columnheader" className="text-right">
                {segment === "upcoming"
                  ? "Publishes"
                  : segment === "live"
                    ? "Live since"
                    : "Decided"}
              </span>
            </div>

            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No sheets match.
              </p>
            ) : (
              <div ref={windowed.ref} className="max-h-[62vh] overflow-y-auto">
                <div style={{ height: windowed.before }} />
                {rows.slice(windowed.start, windowed.end).map((s, i) => {
                  const index = windowed.start + i;
                  return (
                    <SheetRow
                      key={s.id}
                      sheet={s}
                      active={open ? s.id === open.id : index === cursor}
                      picked={picked.has(s.id)}
                      onPick={() => togglePick(s.id)}
                      onOpen={() => {
                        setCursor(index);
                        setSearch({ sheet: s.id });
                      }}
                    />
                  );
                })}
                <div style={{ height: windowed.after }} />
              </div>
            )}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">
              <span className="numeral">{picked.size || rows.length}</span>{" "}
              {picked.size ? "selected" : "shown"}
            </span>
            <div className="flex flex-wrap gap-2">
              {!unread && (
                <button
                  type="button"
                  onClick={() =>
                    void decide(
                      targets.map((s) => s.id),
                      "to_review",
                    )
                  }
                  className="btn-premium inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm"
                >
                  <Undo2 className="size-4" /> Send back
                </button>
              )}
              {segment !== "held" && (
                <button
                  type="button"
                  onClick={() =>
                    void decide(
                      targets.map((s) => s.id),
                      "held",
                    )
                  }
                  className="btn-premium inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm"
                >
                  <Pause className="size-4" /> Hold {targets.length}
                </button>
              )}
              {segment !== "approved" && (
                <button
                  type="button"
                  onClick={() =>
                    void decide(
                      targets.map((s) => s.id),
                      "approved",
                    )
                  }
                  className="btn-solid inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-bold"
                >
                  <Check className="size-4" /> Approve {targets.length}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {open && (
        <SheetPanel
          sheet={open}
          position={`${openIndex + 1} of ${rows.length}`}
          onClose={() => setSearch({ sheet: undefined })}
          onDecide={decideAndAdvance}
          onChanged={refreshCounts}
        />
      )}
    </div>
  );
}

function SheetRow({
  sheet,
  active,
  picked,
  onPick,
  onOpen,
}: {
  sheet: Sheet;
  active: boolean;
  picked: boolean;
  onPick: () => void;
  onOpen: () => void;
}) {
  const flags = sheetFlags(sheet).filter((f) => f !== "live");
  const day = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
  const when =
    sheet.status === "to_review"
      ? (timeLeft(sheet.publishAt) ?? day(sheet.publishAt ?? sheet.createdAt))
      : day(sheet.reviewedAt);
  return (
    <div
      role="row"
      aria-selected={active}
      onClick={onOpen}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        COLUMNS,
        SUBJECT_TINT[sheet.subject],
        "cursor-pointer border-t border-border text-sm hover:bg-muted/40",
        active && "bg-[color-mix(in_oklab,var(--tint)_9%,transparent)]",
      )}
    >
      <input
        type="checkbox"
        aria-label={`Select ${sheet.title}`}
        checked={picked}
        onClick={(e) => e.stopPropagation()}
        onChange={onPick}
      />
      <span role="cell" className="truncate font-medium" title={sheet.title}>
        {sheet.title}
      </span>
      <span role="cell" className="min-w-0">
        <span className="chip">{facetLabel(sheet.subject)}</span>
      </span>
      <span role="cell" className="truncate">
        {facetLabel(sheet.level)}
        {sheet.tier && <span className="text-muted-foreground"> · {facetLabel(sheet.tier)}</span>}
      </span>
      <span role="cell" className="truncate">
        {sheet.board && facetLabel(sheet.board)}
      </span>
      <span
        role="cell"
        className="truncate text-xs text-muted-foreground"
        title={[sheet.specCode, sheet.topicTitle].filter(Boolean).join(" · ")}
      >
        <span className="font-mono text-foreground">{sheet.specCode}</span>
        {sheet.topicTitle && ` ${sheet.topicTitle}`}
      </span>
      <span role="cell" className="numeral text-right">
        {sheet.questionCount}
      </span>
      <span role="cell" className="numeral text-right">
        {sheet.totalMarks}
      </span>
      <span role="cell" className="flex min-w-0 gap-1 overflow-hidden">
        {flags.map((f) => (
          <span key={f} className={cn("chip", FLAG[f].tint)} title={FLAG[f].title}>
            {FLAG[f].label}
          </span>
        ))}
      </span>
      <span role="cell" className="numeral text-right text-xs text-muted-foreground">
        {when}
      </span>
    </div>
  );
}
