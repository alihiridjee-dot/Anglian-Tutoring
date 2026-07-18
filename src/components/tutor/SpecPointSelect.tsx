import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Field } from "./Field";
import { Search, X, ChevronDown, Layers } from "lucide-react";
import { BOARDS, type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

type Row = {
  id: string;
  code: string;
  title: string;
  sort_order: number | null;
  topics: {
    id: string;
    title: string;
    code: string | null;
    board: string | null;
    sort_order: number | null;
  } | null;
};

type Group = {
  topicId: string;
  topicLabel: string;
  board: string | null;
  sort: number;
  points: Row[];
};

type Section = { board: string | null; groups: Group[] };

const BOARD_RANK = new Map(BOARDS.map((b, i) => [b.value as string, i]));
const boardLabel = (b: string) =>
  BOARDS.find((x) => x.value === b)?.label ?? b.toUpperCase();

/**
 * Multi-select curriculum-module picker. Given the current subject/board/level,
 * it loads every spec point (grouped by topic) and lets a tutor attach the
 * resource to as many as apply — homework usually spans several points, and
 * students discover it by browsing any one of them.
 *
 * When `board` is omitted (live sessions, which are board-agnostic broad
 * themes), points from every board for that subject+level are loaded and
 * organised into collapsible **board sections → topics → points**, so a tutor
 * can pick, say, the AQA *and* Edexcel "Photosynthesis" points for one session
 * without the boards blurring into a single flat list.
 *
 * Self-correcting: when the taxonomy changes, selections that no longer exist
 * under the new subject/board/level are dropped, so a resource can't stay linked
 * to a point from a different specification.
 */
export function SpecPointSelect({
  subject,
  board,
  level,
  value,
  onChange,
  required = false,
}: {
  subject: SubjectV;
  board?: BoardV;
  level: LevelV;
  value: string[];
  onChange: (ids: string[]) => void;
  /** Require at least one point; flips the label from "(optional)" and shows a hint when empty. */
  required?: boolean;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());
  const [closedBoards, setClosedBoards] = useState<Set<string>>(new Set());

  // Board sections only appear in all-boards mode (board prop omitted); a single
  // known board doesn't need a section wrapper.
  const showBoardSections = !board;

  const toggleTopic = (topicId: string) =>
    setOpenTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });

  const toggleBoard = (b: string) =>
    setClosedBoards((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from("spec_points")
        .select("id, code, title, sort_order, topics!inner(id, title, code, board, sort_order)")
        .eq("topics.subject", subject)
        .eq("topics.level", level);
      // Board-agnostic mode (live sessions): load every board's points.
      if (board) q = q.eq("topics.board", board);
      const { data, error } = await q;
      if (cancelled) return;

      const rows = (error ? [] : ((data ?? []) as unknown as Row[])) ?? [];
      const byTopic = new Map<string, Group>();
      for (const r of rows) {
        const t = r.topics;
        if (!t) continue;
        if (!byTopic.has(t.id)) {
          byTopic.set(t.id, {
            topicId: t.id,
            topicLabel: t.code ? `${t.code} · ${t.title}` : t.title,
            board: t.board,
            sort: t.sort_order ?? 0,
            points: [],
          });
        }
        byTopic.get(t.id)!.points.push(r);
      }
      // Order topics by board (Edexcel → AQA → OCR) then the topic's own order.
      const list = [...byTopic.values()].sort(
        (a, b) =>
          (BOARD_RANK.get(a.board ?? "") ?? 99) - (BOARD_RANK.get(b.board ?? "") ?? 99) ||
          a.sort - b.sort,
      );
      for (const g of list) {
        g.points.sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code),
        );
      }
      setGroups(list);
      setLoading(false);

      // Drop stale selections that don't exist under the new taxonomy.
      const valid = new Set(rows.map((r) => r.id));
      const kept = value.filter((id) => valid.has(id));
      if (kept.length !== value.length) onChange(kept);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, board, level]);

  const selected = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        points: g.points.filter(
          (p) =>
            p.code.toLowerCase().includes(q) ||
            p.title.toLowerCase().includes(q) ||
            g.topicLabel.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.points.length > 0);
  }, [groups, query]);

  // Split the (filtered) topic groups into board sections, preserving order.
  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    for (const g of filtered) {
      const last = out[out.length - 1];
      if (last && last.board === g.board) last.groups.push(g);
      else out.push({ board: g.board, groups: [g] });
    }
    return out;
  }, [filtered]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const label =
    value.length > 0
      ? `Curriculum spec points — ${value.length} selected`
      : required
        ? "Curriculum spec points (required)"
        : "Curriculum spec points (optional)";

  const renderTopic = (g: Group) => {
    // While searching, force topics open so matches are always visible;
    // otherwise honour the tutor's expand/collapse choice.
    const isOpen = query.trim() ? true : openTopics.has(g.topicId);
    const selectedCount = g.points.filter((p) => selected.has(p.id)).length;
    return (
      <div key={g.topicId}>
        <button
          type="button"
          onClick={() => toggleTopic(g.topicId)}
          className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/80 backdrop-blur text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground hover:bg-muted"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`}
          />
          <span className="text-left flex-1">{g.topicLabel}</span>
          {selectedCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary/15 text-primary text-[9px] shrink-0">
              {selectedCount}
            </span>
          )}
          <span className="text-muted-foreground/70 shrink-0">{g.points.length}</span>
        </button>
        {isOpen &&
          g.points.map((p) => (
            <label
              key={p.id}
              className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/40 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                className="mt-0.5 w-4 h-4 rounded border-border accent-primary shrink-0"
              />
              <span className="text-sm leading-snug">
                <span className="font-medium">{p.code}</span>{" "}
                <span className="text-muted-foreground">· {p.title}</span>
              </span>
            </label>
          ))}
      </div>
    );
  };

  return (
    <Field label={label}>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={loading ? "Loading spec points…" : "Search by code or title…"}
            disabled={loading}
            className="flex-1 bg-transparent text-sm focus:outline-none disabled:opacity-60"
          />
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>

        <div className="max-h-56 overflow-auto">
          {loading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : sections.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {groups.length === 0
                ? "No spec points for this subject and level."
                : "No spec points match that search."}
            </p>
          ) : showBoardSections ? (
            sections.map((sec) => {
              const b = sec.board ?? "other";
              const isBoardOpen = query.trim() ? true : !closedBoards.has(b);
              const secSelected = sec.groups.reduce(
                (n, g) => n + g.points.filter((p) => selected.has(p.id)).length,
                0,
              );
              return (
                <div key={b}>
                  <button
                    type="button"
                    onClick={() => toggleBoard(b)}
                    className="sticky top-0 z-20 w-full flex items-center gap-2 px-3 py-2 bg-primary/10 border-y border-primary/15 text-xs font-bold uppercase tracking-wider text-primary hover:bg-primary/15"
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-left flex-1">
                      {sec.board ? boardLabel(sec.board) : "Other"}
                    </span>
                    {secSelected > 0 && (
                      <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary/20 text-primary text-[9px] shrink-0">
                        {secSelected}
                      </span>
                    )}
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${isBoardOpen ? "" : "-rotate-90"}`}
                    />
                  </button>
                  {isBoardOpen && sec.groups.map(renderTopic)}
                </div>
              );
            })
          ) : (
            // Single-board mode (homework/videos): topics only, no board wrapper.
            filtered.map(renderTopic)
          )}
        </div>
      </div>
      {required && value.length === 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Pick at least one spec point — a live session must be tied to the curriculum it covers.
        </p>
      )}
    </Field>
  );
}
