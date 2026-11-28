import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import {
  Search,
  X,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Loader2,
  MessageCircleQuestion,
} from "lucide-react";
import { useGlobalSearch, useSearchContext } from "@/hooks/useGlobalSearch";
import { MIN_QUERY_LENGTH } from "@/lib/search/match";
import { searchTerms, type HelpIntentId } from "@/lib/search/help";
import { askHelp, explainHelp } from "@/lib/search/helpAsk.functions";
import { explainSection, findNote } from "@/lib/search/helpAnswers";
import { PER_GROUP_LIMIT, type SearchSection } from "@/lib/search/globalSearch";
import type { SearchHit } from "@/lib/search/types";
import { SegmentedToggle } from "@/components/Shared";
import { SUBJECT_TINT, subjectLabel } from "@/lib/curriculum/subjectTheme";
import { cn } from "@/lib/utils";
import { Highlight } from "./Highlight";

/** The three sciences, in the order the switch shows them. */
const SCIENCES = ["biology", "chemistry", "physics"] as const;

/**
 * One subject's results: the best five of that subject in each kind, not the
 * ones of that subject that happened to make the overall five. Help answers are
 * about the student's week, not a subject, so they stay whatever is picked.
 */
function inSubject(sections: SearchSection[], subject: string): SearchSection[] {
  return sections.flatMap((section) => {
    if (section.group === "help") return [section];
    const matched = (section.ranked ?? section.hits).filter((h) => h.subject === subject);
    if (matched.length === 0) return [];
    return [{ ...section, hits: matched.slice(0, PER_GROUP_LIMIT), total: matched.length }];
  });
}

/** How many results each science has, across every kind. */
function subjectCounts(sections: SearchSection[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const section of sections) {
    if (section.group === "help") continue;
    for (const hit of section.ranked ?? section.hits) {
      if (hit.subject) counts[hit.subject] = (counts[hit.subject] ?? 0) + 1;
    }
  }
  return counts;
}

/** Tappable starters in a student's empty box, so it reads as taking sentences. */
const HELP_EXAMPLES = [
  "Find my MCQ for this week",
  "What tasks are due?",
  "What should I revise?",
  "When is my next live session?",
];

/** One science question per subject, so the box shows it answers those too. */
const SCIENCE_EXAMPLE: Record<string, string> = {
  biology: "Why does osmosis happen?",
  chemistry: "Why do ionic compounds conduct when molten?",
  physics: "Why does a current make a wire hot?",
};

/**
 * The global search palette — one box that reaches every page and every piece
 * of content the caller can see.
 *
 * It is keyboard-first: ⌘K (Ctrl+K) opens it from anywhere, ↑/↓ walk the
 * results *across* group boundaries, Enter opens the highlighted one, Esc
 * closes. The mouse can do all of the same, and hovering moves the highlight so
 * the two input methods never disagree about what Enter would do.
 *
 * For a student it is also the help box. A sentence the rules recognise is
 * answered on top as they type; one they don't gets a last row, "Ask for
 * help", which asks the model what it means — only when chosen, never per key.
 * A science question comes back as a short answer written from one of our
 * notes, with the note beside it.
 */
export function GlobalSearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // The model's reading of one query, kept only while that query is on screen.
  const [asked, setAsked] = useState<{ query: string; intent: HelpIntentId } | null>(null);
  const forced = asked && asked.query === query.trim() ? asked.intent : null;
  const {
    sections: found,
    terms,
    loading,
    active,
    error,
    helpOn,
    intent,
  } = useGlobalSearch(query, forced);
  const ctx = useSearchContext();

  // A science answer for one query, kept only while that query is on screen.
  const [answered, setAnswered] = useState<{ query: string; section: SearchSection } | null>(null);
  const answer = answered && answered.query === query.trim() ? answered.section : null;
  const all = useMemo(() => (answer ? [answer, ...found] : found), [answer, found]);

  // A student's results sort by science: All, or one subject at a time. A
  // tutor searches across students, so theirs stay grouped by kind alone.
  const bySubject = !ctx.isTutor;
  const [picked, setPicked] = useState<string>("all");
  const counts = useMemo(() => subjectCounts(found), [found]);
  // A subject the new query found nothing in falls back to All.
  const subject = picked !== "all" && counts[picked] ? picked : "all";
  const sections = useMemo(
    () => (bySubject && subject !== "all" ? inSubject(all, subject) : all),
    [all, bySubject, subject],
  );
  const showSwitch = bySubject && Object.keys(counts).length > 0;

  // Keyboard navigation walks one flat list; the group headers are purely visual.
  const flat = useMemo(() => sections.flatMap((s) => s.hits), [sections]);

  const latestQuery = useRef(query);
  latestQuery.current = query;
  const ask = useMutation({
    mutationFn: async (question: string) => {
      const reply = await askHelp({ data: { question } });
      if (reply.intent !== "explain") return { reply, section: null };
      // A science question: answered from the note that covers it, if one does.
      const note = await findNote(reply.topic, ctx);
      if (!note) return { reply, section: null };
      const { answer } = await explainHelp({ data: { question, conceptId: note.conceptId } });
      return { reply, section: explainSection(note, answer) };
    },
    onSuccess: ({ reply, section }, question) => {
      // The student has typed on since; this answer is for a query that's gone.
      if (latestQuery.current.trim() !== question) return;
      if (section) {
        setAnswered({ query: question, section });
        return;
      }
      // Practice on a topic reads the topic from the box, so it is put there.
      if (reply.intent === "practice" && reply.topic) {
        setQuery(`Practice ${reply.topic}`);
        return;
      }
      // A topic with no note to answer from is still worth searching for.
      const topic = reply.intent === "search" || reply.intent === "explain" ? reply.topic : null;
      if (topic && topic !== searchTerms(question).join(" ")) {
        setQuery(topic);
        return;
      }
      // Nothing on the list fits: their tutor is the help.
      const understood =
        reply.intent === "search" || reply.intent === "explain" || reply.intent === "none"
          ? null
          : reply.intent;
      setAsked({ query: question, intent: understood ?? "messages" });
    },
  });
  const resetAsk = ask.reset;
  useEffect(() => resetAsk(), [query, resetAsk]);

  // Offered once a sentence has been typed that no rule recognised.
  const askable = helpOn && active && !intent && !answer && query.trim().split(/\s+/).length >= 2;
  const total = flat.length + (askable ? 1 : 0);
  const runAsk = () => {
    if (!ask.isPending) ask.mutate(query.trim());
  };

  // A new result set invalidates the old cursor position.
  useEffect(() => setActiveIndex(0), [flat, askable]);

  // Reopening should be a fresh search, not a stale one from last time.
  useEffect(() => {
    if (open) {
      setQuery("");
      setAsked(null);
      setAnswered(null);
      setPicked("all");
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
    if (total === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[activeIndex];
      if (hit) select(hit);
      else if (askable) runAsk();
    }
  };

  if (!open) return null;

  let cursor = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4 sm:pt-[10vh] bg-foreground/25 backdrop-blur-sm"
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
            placeholder={
              helpOn ? "Search or ask for help…" : "Search spec points, tasks, sessions, quizzes…"
            }
            aria-label="Search"
            className="flex-1 min-w-0 bg-transparent text-base focus:outline-none placeholder:text-muted-foreground/70"
          />
          {loading && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />}
          <button
            onClick={onClose}
            aria-label="Close search"
            className="tap-target shrink-0 text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-secondary transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {showSwitch && (
          <div className="px-4 py-2.5 border-b border-border">
            <SegmentedToggle
              layoutId="search-subject-pill"
              label="Subject"
              value={subject}
              onChange={(v) => {
                setPicked(v);
                inputRef.current?.focus();
              }}
              items={[
                { value: "all", label: "All" },
                ...SCIENCES.filter(
                  (s) => ctx.isDemo || ctx.entitledSubjects.includes(s) || counts[s],
                ).map((s) => ({
                  value: s,
                  label: subjectLabel(s),
                  count: counts[s] ?? 0,
                  tint: SUBJECT_TINT[s],
                })),
              ]}
            />
          </div>
        )}

        <div ref={listRef} className="max-h-[60dvh] overflow-y-auto">
          {!active && helpOn ? (
            <HelpStart
              examples={[
                ...HELP_EXAMPLES,
                ...ctx.entitledSubjects.slice(0, 1).map((s) => SCIENCE_EXAMPLE[s] ?? []),
              ].flat()}
              onPick={(q) => {
                setQuery(q);
                inputRef.current?.focus();
              }}
            />
          ) : !active ? (
            <EmptyState
              title="Search everything"
              body={`Type at least ${MIN_QUERY_LENGTH} characters to search across the specification, tasks, live sessions, videos and quizzes.`}
            />
          ) : error ? (
            <EmptyState title="Search failed" body={error} />
          ) : flat.length === 0 && !askable ? (
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
              <div key={section.answer ? "answer" : section.group}>
                <div className="sticky top-0 z-10 flex items-baseline justify-between gap-2 px-4 py-1.5 bg-muted/85 backdrop-blur text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
                  <span>{section.label}</span>
                  {section.total > section.hits.length && (
                    <span className="font-semibold tracking-normal normal-case">
                      showing {section.hits.length} of {section.total}
                    </span>
                  )}
                </div>
                {section.answer && (
                  <p className="text-foreground px-4 pt-3 pb-2 text-sm leading-relaxed font-medium">
                    {section.answer}
                  </p>
                )}
                {section.hits.map((hit) => {
                  cursor += 1;
                  const index = cursor;
                  return (
                    <ResultRow
                      key={hit.key}
                      hit={hit}
                      terms={terms}
                      showTags={!bySubject}
                      active={index === activeIndex}
                      onHover={() => setActiveIndex(index)}
                      onSelect={() => select(hit)}
                    />
                  );
                })}
              </div>
            ))
          )}
          {active && !error && askable && (
            <AskRow
              query={query.trim()}
              active={activeIndex === flat.length}
              pending={ask.isPending}
              error={ask.error instanceof Error ? ask.error.message : null}
              onHover={() => setActiveIndex(flat.length)}
              onSelect={runAsk}
            />
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
  showTags,
  active,
  onHover,
  onSelect,
}: {
  hit: SearchHit;
  terms: string[];
  /** Off for a student: their board and level are the same on every row, and colour says the subject. */
  showTags: boolean;
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
      // A science's row wears that science's colour: its icon and its code.
      className={cn(
        "w-full flex min-h-11 items-start gap-3 px-4 py-2.5 text-left transition cursor-pointer",
        hit.subject ? SUBJECT_TINT[hit.subject] : undefined,
        active ? "bg-tint/10" : "hover:bg-secondary/40",
      )}
    >
      <Icon
        className={cn(
          "w-4 h-4 mt-0.5 shrink-0",
          hit.subject || active ? "text-tint" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          {hit.code && (
            <span className="text-[11px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-tint/10 text-tint shrink-0">
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
      {showTags && hit.tags && hit.tags.length > 0 && (
        <span className="hidden sm:block text-[10px] uppercase tracking-wider font-bold text-muted-foreground/70 shrink-0 mt-1">
          {hit.tags.join(" · ")}
        </span>
      )}
    </button>
  );
}

/** The last row for a sentence no rule recognised: hands it to the model. */
function AskRow({
  query,
  active,
  pending,
  error,
  onHover,
  onSelect,
}: {
  query: string;
  active: boolean;
  pending: boolean;
  error: string | null;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-active={active}
      onMouseMove={onHover}
      onClick={onSelect}
      disabled={pending}
      className={`w-full flex min-h-11 items-center gap-3 px-4 py-2.5 text-left border-t border-border transition cursor-pointer ${
        active ? "bg-primary/10" : "hover:bg-secondary/40"
      }`}
    >
      {pending ? (
        <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" />
      ) : (
        <MessageCircleQuestion
          className={`w-4 h-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
        />
      )}
      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground truncate">
        {pending ? "Working it out…" : (error ?? `Ask for help: “${query}”`)}
      </span>
    </button>
  );
}

/** A student's empty box: what it can do, shown as things to press. */
function HelpStart({ examples, onPick }: { examples: string[]; onPick: (query: string) => void }) {
  return (
    <div className="px-6 py-8 text-center">
      <p className="font-display text-foreground text-sm font-bold">Search or ask for help</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {examples.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="chip tap-target cursor-pointer hover:brightness-95"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="font-display text-foreground text-sm font-bold">{title}</p>
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
