import { useMemo } from "react";
import {
  SUBJECTS,
  BOARDS,
  LEVELS,
  type SubjectV,
  type BoardV,
  type LevelV,
} from "@/lib/curriculum/taxonomy";
import type { SpecPoint, SpecPointMatch } from "@/lib/curriculum/types";
import { Highlight } from "@/components/search/Highlight";
import { Search, X } from "lucide-react";
import { labelOf } from "@/components/curriculum/styles";

/**
 * The specification search box.
 *
 * It names the specification it searches ("Search Biology · Edexcel · GCSE"),
 * because the same box returns entirely different results after a subject
 * switch and there is otherwise nothing on screen saying so.
 */
export function SpecSearchBar({
  value,
  onChange,
  subject,
  board,
  level,
}: {
  value: string;
  onChange: (v: string) => void;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
}) {
  const scope = [labelOf(SUBJECTS, subject), labelOf(BOARDS, board), labelOf(LEVELS, level)].join(
    " · ",
  );
  return (
    <div className="flex items-center gap-2.5 h-11 px-3.5 rounded-xl bg-secondary border border-border focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition">
      <Search className="w-4 h-4 text-muted-foreground shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Search ${scope} — spec code, title or description`}
        aria-label={`Search the ${scope} specification`}
        className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/70"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition"
        >
          <X className="w-3.5 h-3.5" /> Clear
        </button>
      )}
    </div>
  );
}

/**
 * Search results, grouped under the topic each point belongs to.
 *
 * The topic grouping is the part that makes the results *teach* something: it
 * answers "where does this sit in the spec?" at the same time as "here it is",
 * which is exactly the context a student browsing blind is missing.
 */
export function SpecSearchResults({
  matches,
  terms,
  loading,
  query,
  onSelect,
  onClear,
}: {
  matches: SpecPointMatch[];
  terms: string[];
  loading: boolean;
  query: string;
  onSelect: (p: SpecPoint) => void;
  onClear: () => void;
}) {
  // Groups keep the ranked order: the topic holding the best match comes first.
  const groups = useMemo(() => {
    const byTopic = new Map<string, { topic: SpecPointMatch["topic"]; points: SpecPointMatch[] }>();
    for (const m of matches) {
      const existing = byTopic.get(m.topic.id);
      if (existing) existing.points.push(m);
      else byTopic.set(m.topic.id, { topic: m.topic, points: [m] });
    }
    return [...byTopic.values()];
  }, [matches]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Searching the specification…</p>;
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center">
        <Search className="w-8 h-8 mx-auto mb-3 opacity-40 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">
          No spec points match “{query.trim()}”
        </p>
        <p className="text-xs text-muted-foreground mt-1.5">
          Try a spec code like 4.1, a single keyword, or check the subject and board above.
        </p>
        <button
          onClick={onClear}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
        >
          <X className="w-3.5 h-3.5" /> Clear search
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{matches.length}</span> spec{" "}
          {matches.length === 1 ? "point" : "points"} across{" "}
          <span className="font-semibold text-foreground">{groups.length}</span>{" "}
          {groups.length === 1 ? "topic" : "topics"}
        </p>
        <button
          onClick={onClear}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition"
        >
          <X className="w-3.5 h-3.5" /> Back to all topics
        </button>
      </div>

      {groups.map(({ topic, points }) => (
        <div key={topic.id} className="rounded-2xl premium-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border bg-secondary/30">
            {topic.code && (
              <span className="text-[11px] font-bold tracking-wide px-2 py-0.5 rounded bg-[color:color-mix(in_oklab,var(--tint)_15%,transparent)] text-[color:var(--tint)] shrink-0">
                {topic.code}
              </span>
            )}
            <span className="font-display font-bold text-sm truncate">
              <Highlight text={topic.title} terms={terms} />
            </span>
            <span className="ml-auto text-[11px] font-semibold text-muted-foreground shrink-0">
              {points.length} {points.length === 1 ? "match" : "matches"}
            </span>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {points.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className="text-left p-4 rounded-xl border border-border bg-secondary/10 hover:border-primary/50 hover:bg-secondary/30 transition flex items-start gap-3 group cursor-pointer"
              >
                <span className="text-[11px] font-bold tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded shrink-0 mt-0.5">
                  <Highlight text={p.code} terms={terms} />
                </span>
                <div className="min-w-0">
                  <h4 className="font-semibold text-sm text-foreground leading-tight group-hover:text-primary transition">
                    <Highlight text={p.title} terms={terms} />
                  </h4>
                  {p.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-normal">
                      <Highlight text={p.description} terms={terms} />
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
