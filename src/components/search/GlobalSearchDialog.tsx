import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, X, CornerDownLeft, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { MIN_QUERY_LENGTH } from "@/lib/search/match";
import type { SearchHit } from "@/lib/search/types";
import { Highlight } from "./Highlight";

/**
 * The global search palette — one box that reaches every page and every piece
 * of content the caller can see.
 *
 * It is keyboard-first: ⌘K (Ctrl+K) opens it from anywhere, ↑/↓ walk the
 * results *across* group boundaries, Enter opens the highlighted one, Esc
 * closes. The mouse can do all of the same, and hovering moves the highlight so
 * the two input methods never disagree about what Enter would do.
 */
export function GlobalSearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { sections, terms, loading, active, error } = useGlobalSearch(query);

  // Keyboard navigation walks one flat list; the group headers are purely visual.
  const flat = useMemo(() => sections.flatMap((s) => s.hits), [sections]);

  // A new result set invalidates the old cursor position.
  useEffect(() => setActiveIndex(0), [flat]);

  // Reopening should be a fresh search, not a stale one from last time.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Autofocus after the element is actually in the tree.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep the highlighted row in view when the cursor is driven by the keyboard.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const select = (hit: SearchHit) => {
    onClose();
    // Targets are assembled from data at runtime, so they can't be narrowed to
    // the router's literal route union — this is the single place that widens.
    navigate({ to: hit.to, params: hit.params, search: hit.search } as never);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[activeIndex];
      if (hit) select(hit);
    }
  };

  if (!open) return null;

  let cursor = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh] bg-foreground/25 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-2xl rounded-2xl premium-card overflow-hidden shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 px-4 h-14 border-b border-border">
          <Search className="w-4.5 h-4.5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search spec points, homework, sessions, quizzes…"
            aria-label="Search"
            className="flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-muted-foreground/70"
          />
          {loading && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />}
          <button
            onClick={onClose}
            aria-label="Close search"
            className="shrink-0 text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-secondary transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {!active ? (
            <EmptyState
              title="Search everything"
              body={`Type at least ${MIN_QUERY_LENGTH} characters to search across the specification, homework, live sessions, videos, downloads and quizzes.`}
            />
          ) : error ? (
            <EmptyState title="Search failed" body={error} />
          ) : flat.length === 0 ? (
            <EmptyState
              title={loading ? "Searching…" : "No matches"}
              body={
                loading
                  ? "Looking across your subjects."
                  : `Nothing matched “${query.trim()}”. Try a spec code, a topic name, or fewer words.`
              }
            />
          ) : (
            sections.map((section) => (
              <div key={section.group}>
                <div className="sticky top-0 z-10 flex items-baseline justify-between gap-2 px-4 py-1.5 bg-muted/85 backdrop-blur text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                  <span>{section.label}</span>
                  {section.total > section.hits.length && (
                    <span className="font-semibold tracking-normal normal-case">
                      showing {section.hits.length} of {section.total}
                    </span>
                  )}
                </div>
                {section.hits.map((hit) => {
                  cursor += 1;
                  const index = cursor;
                  return (
                    <ResultRow
                      key={hit.key}
                      hit={hit}
                      terms={terms}
                      active={index === activeIndex}
                      onHover={() => setActiveIndex(index)}
                      onSelect={() => select(hit)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-border bg-muted/40 text-[11px] text-muted-foreground">
          <Hint icon={<ArrowUp className="w-3 h-3" />} extra={<ArrowDown className="w-3 h-3" />}>
            navigate
          </Hint>
          <Hint icon={<CornerDownLeft className="w-3 h-3" />}>open</Hint>
          <Hint label="Esc">close</Hint>
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  hit,
  terms,
  active,
  onHover,
  onSelect,
}: {
  hit: SearchHit;
  terms: string[];
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const Icon = hit.icon;
  return (
    <button
      type="button"
      data-active={active}
      onMouseMove={onHover}
      onClick={onSelect}
      className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition cursor-pointer ${
        active ? "bg-primary/10" : "hover:bg-secondary/40"
      }`}
    >
      <Icon
        className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          {hit.code && (
            <span className="text-[11px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
              <Highlight text={hit.code} terms={terms} />
            </span>
          )}
          <span className="text-sm font-semibold text-foreground truncate">
            <Highlight text={hit.title} terms={terms} />
          </span>
        </div>
        {hit.subtitle && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            <Highlight text={hit.subtitle} terms={terms} />
          </p>
        )}
      </div>
      {hit.tags && hit.tags.length > 0 && (
        <span className="hidden sm:block text-[10px] uppercase tracking-wider font-bold text-muted-foreground/70 shrink-0 mt-1">
          {hit.tags.join(" · ")}
        </span>
      )}
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function Hint({
  icon,
  extra,
  label,
  children,
}: {
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5">
        {icon && <Key>{icon}</Key>}
        {extra && <Key>{extra}</Key>}
        {label && <Key>{label}</Key>}
      </span>
      {children}
    </span>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded border border-border bg-background text-[10px] font-semibold text-foreground">
      {children}
    </kbd>
  );
}
