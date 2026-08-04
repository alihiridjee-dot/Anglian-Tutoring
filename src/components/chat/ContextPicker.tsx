import { useEffect, useMemo, useState } from "react";
import { BookMarked, ClipboardList, ListChecks, Loader2, MessageSquare, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CurriculumDAL, type SpecPointMatch } from "@/lib/curriculumDal";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { subjectLabel } from "@/lib/courseSummary";
import { EMPTY_CONTEXT, type ChatContextSelection } from "@/lib/chatContext";
import type { BoardV, LevelV, SubjectV } from "@/lib/taxonomy";

/**
 * What the question is about: a spec point, a homework, a quiz, or nothing.
 *
 * The whole value of attaching context is that the tutor opens the thread
 * already knowing which line of the specification the student is stuck on,
 * instead of spending the first two replies working it out. So this offers the
 * three things a student is ever looking at when they get stuck, and a plain
 * "general question" for everything else — never a free-text "topic" box, which
 * would produce labels nothing can link to.
 *
 * Each selection carries a `label` snapshot alongside its id: the thread stores
 * both, so the conversation can still say what it was about even if the linked
 * row is later renamed, deleted, or gated behind a lapsed subscription.
 */

const TABS = [
  { key: "general", label: "General", icon: MessageSquare },
  { key: "spec_point", label: "Spec point", icon: BookMarked },
  { key: "homework", label: "Homework", icon: ClipboardList },
  { key: "mcq_set", label: "Quiz", icon: ListChecks },
] as const;

interface Props {
  value: ChatContextSelection;
  onChange: (value: ChatContextSelection) => void;
}

export function ContextPicker({ value, onChange }: Props) {
  const [tab, setTab] = useState<ChatContextSelection["kind"]>(value.kind);

  const select = (next: ChatContextSelection) => onChange(next);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                // Changing tab drops the previous attachment: a thread carries
                // at most one piece of context (the database enforces it too).
                if (key === "general") select(EMPTY_CONTEXT);
                else select({ kind: key });
              }}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold transition ${
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          );
        })}
      </div>

      {value.label && (
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{value.label}</span>
          <button
            type="button"
            onClick={() => {
              setTab("general");
              select(EMPTY_CONTEXT);
            }}
            aria-label="Remove attachment"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!value.label && tab === "spec_point" && <SpecPointSearch onPick={select} />}
      {!value.label && tab === "homework" && <HomeworkList onPick={select} />}
      {!value.label && tab === "mcq_set" && <QuizList onPick={select} />}
    </div>
  );
}

/** Shared shell for the three attachment lists. */
function PickerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2.5 max-h-52 overflow-y-auto rounded-xl border border-border divide-y divide-border">
      {children}
    </div>
  );
}

function PickerRow({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2.5 text-left hover:bg-muted/50"
    >
      <div className="text-sm font-medium truncate">{title}</div>
      {subtitle && <div className="text-xs text-muted-foreground truncate">{subtitle}</div>}
    </button>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-4 text-center text-xs text-muted-foreground">{children}</p>;
}

/**
 * Spec-point search across every subject the student is enrolled in, using the
 * same ranked matcher as global search rather than a second search idea.
 */
function SpecPointSearch({ onPick }: { onPick: (s: ChatContextSelection) => void }) {
  const { enrolments, level } = useEnrolments();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(SpecPointMatch & { subject: SubjectV })[]>([]);
  const [searching, setSearching] = useState(false);

  const courses = useMemo(
    () =>
      level
        ? enrolments.map((e) => ({
            level: level as LevelV,
            board: e.board as BoardV,
            subject: e.subject as SubjectV,
          }))
        : [],
    [enrolments, level],
  );

  useEffect(() => {
    if (query.trim().length < 2 || courses.length === 0) {
      setResults([]);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      const batches = await Promise.all(
        courses.map(async (c) => {
          const hits = await CurriculumDAL.searchSpecPoints(c.level, c.board, c.subject, query, 8);
          return hits.map((h) => ({ ...h, subject: c.subject }));
        }),
      );
      if (!alive) return;
      setResults(
        batches
          .flat()
          .sort((a, b) => b.score - a.score)
          .slice(0, 12),
      );
      setSearching(false);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, courses]);

  return (
    <div className="mt-2.5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your spec — e.g. osmosis, 4.1.2…"
        className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
      />
      {query.trim().length >= 2 && (
        <PickerShell>
          {searching ? (
            <div className="py-4 text-center">
              <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <EmptyRow>No spec points match that.</EmptyRow>
          ) : (
            results.map((r) => (
              <PickerRow
                key={r.id}
                title={`${r.code} ${r.title}`}
                subtitle={`${subjectLabel(r.subject)} · ${r.topic.title}`}
                onClick={() =>
                  onPick({
                    kind: "spec_point",
                    specPointId: r.id,
                    subject: r.subject,
                    label: `${r.code} ${r.title}`,
                  })
                }
              />
            ))
          )}
        </PickerShell>
      )}
    </div>
  );
}

function HomeworkList({ onPick }: { onPick: (s: ChatContextSelection) => void }) {
  const [rows, setRows] = useState<{ id: string; title: string; subject: SubjectV }[] | null>(null);

  useEffect(() => {
    supabase
      .from("resources")
      .select("id, title, subject, created_at")
      .eq("kind", "homework")
      .order("created_at", { ascending: false })
      .limit(25)
      .then(({ data }) => setRows(data ?? []));
  }, []);

  return (
    <PickerShell>
      {rows === null ? (
        <div className="py-4 text-center">
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyRow>No homework set yet.</EmptyRow>
      ) : (
        rows.map((r) => (
          <PickerRow
            key={r.id}
            title={r.title}
            subtitle={subjectLabel(r.subject)}
            onClick={() =>
              onPick({
                kind: "homework",
                resourceId: r.id,
                subject: r.subject,
                label: `Homework: ${r.title}`,
              })
            }
          />
        ))
      )}
    </PickerShell>
  );
}

function QuizList({ onPick }: { onPick: (s: ChatContextSelection) => void }) {
  const [rows, setRows] = useState<
    { id: string; title: string; subject: SubjectV | null }[] | null
  >(null);

  useEffect(() => {
    supabase
      .from("mcq_sets")
      .select("id, title, subject, created_at")
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(25)
      .then(({ data }) => setRows(data ?? []));
  }, []);

  return (
    <PickerShell>
      {rows === null ? (
        <div className="py-4 text-center">
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyRow>No quizzes published yet.</EmptyRow>
      ) : (
        rows.map((r) => (
          <PickerRow
            key={r.id}
            title={r.title}
            subtitle={r.subject ? subjectLabel(r.subject) : undefined}
            onClick={() =>
              onPick({
                kind: "mcq_set",
                mcqSetId: r.id,
                subject: r.subject,
                label: `Quiz: ${r.title}`,
              })
            }
          />
        ))
      )}
    </PickerShell>
  );
}
