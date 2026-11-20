import { ErrorNote, Spinner } from "@/components/Shared";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CurriculumDAL } from "@/lib/curriculum/curriculumDal";
import type { SpecPointMatch } from "@/lib/curriculum/types";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { CONTEXT_EMOJI, EMPTY_CONTEXT, type ChatContextSelection } from "@/lib/chat/chatContext";
import { courseScopeFilter } from "@/lib/chat/contextScope";
import { selectIn } from "@/lib/platform/db/chunked";
import { CHAT_KEY } from "@/hooks/data/useChat";
import type { BoardV, LevelV, SubjectV } from "@/lib/curriculum/taxonomy";

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
  { key: "general", label: "General" },
  { key: "spec_point", label: "Spec point" },
  { key: "homework", label: "Task" },
  { key: "mcq_set", label: "Quiz" },
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
      <StopTrail
        label="What it's about"
        stops={TABS.map(({ key, label }) => ({ key, label, glyph: CONTEXT_EMOJI[key] }))}
        picked={tab}
        onPick={(key) => {
          setTab(key);
          // Changing stop drops the previous attachment: a thread carries at
          // most one piece of context (the database enforces it too).
          if (key === "general") select(EMPTY_CONTEXT);
          else select({ kind: key });
        }}
      />

      {value.label && (
        <div className="ask-attached point-panel">
          <span aria-hidden className="text-xl leading-none">
            📎
          </span>
          <span className="min-w-0 flex-1 truncate font-bold">{value.label}</span>
          <button
            type="button"
            onClick={() => {
              setTab("general");
              select(EMPTY_CONTEXT);
            }}
            aria-label="Remove attachment"
            className="btn-ghost flex size-11 shrink-0 items-center justify-center rounded-full sm:pointer-fine:size-9"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {!value.label && tab === "spec_point" && <SpecPointSearch onPick={select} />}
      {!value.label && tab === "homework" && <HomeworkList onPick={select} />}
      {!value.label && tab === "mcq_set" && <QuizList onPick={select} />}
    </div>
  );
}

/**
 * A few choices as round stops on a dotted line, the spec point trail drawn
 * small: the picked stop grows and takes the highlighter ring. The question
 * dialog uses it for what a question is about, and for a parent's tutor.
 */
export function StopTrail<K extends string>({
  label,
  stops,
  picked,
  onPick,
}: {
  /** Names the group for a screen reader. */
  label: string;
  stops: readonly { key: K; label: string; glyph: string }[];
  picked: K;
  onPick: (key: K) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="point-trail ask-trail"
      style={{ "--stops": stops.length } as React.CSSProperties}
    >
      {stops.length > 1 && <TrailLine gaps={stops.length - 1} />}
      {stops.map((s) => (
        <button
          key={s.key}
          type="button"
          aria-pressed={s.key === picked}
          onClick={() => onPick(s.key)}
          className="point-stop"
        >
          <span aria-hidden className="point-stop-dot">
            {s.glyph}
          </span>
          <span className="point-stop-label">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The dotted line between the stops: SpecPointDetail's TrailPath, drawn here
 * rather than imported, so the question dialog doesn't load the spec point page.
 */
function TrailLine({ gaps }: { gaps: number }) {
  let d = "M0 20";
  for (let i = 0; i < gaps; i++) {
    const x = i * 100;
    const [up, down] = i % 2 ? [36, 4] : [4, 36];
    d += ` C${x + 30} ${up} ${x + 70} ${down} ${x + 100} 20`;
  }
  return (
    <svg
      aria-hidden
      className="point-trail-path"
      viewBox={`0 0 ${gaps * 100} 40`}
      preserveAspectRatio="none"
    >
      <path d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Where the three attachment lists open: one soft panel under the stops, bare
 * rows inside, no dividers.
 */
function PickerShell({ children }: { children: React.ReactNode }) {
  return (
    // Shorter on a phone turned sideways, so the list can't fill the dialog's
    // scrolling form and catch every swipe meant for the form around it.
    <div className="ask-list point-panel scroll-slim max-h-56 short:max-h-32 overflow-y-auto">
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
    <button type="button" onClick={onClick} className="ask-row">
      <span className="block truncate font-bold">{title}</span>
      {subtitle && <span className="block truncate text-sm">{subtitle}</span>}
    </button>
  );
}

/** A failed list read, in the same slot the list would fill. */
function PickerError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="mt-3">
      <ErrorNote error={error} onRetry={onRetry} />
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-4 text-center font-medium">{children}</p>;
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
    <div className="point-panel mt-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your spec — e.g. osmosis, 4.1.2…"
        aria-label="Search your spec"
        className="pop-input h-12 w-full px-4 text-base"
      />
      {query.trim().length >= 2 && (
        <PickerShell>
          {searching ? (
            <Spinner className="py-4" />
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

/** How many items each attachment list offers, newest first. */
const PICKER_LIMIT = 25;

/**
 * The student's own homework, by the homework page's rule: their level, and
 * each subject on its own board (or a brief for every board). Row-level
 * security scopes `resources` by subject alone, so without this the newest 25
 * sheets on the whole platform pushed the student's own work out of the list.
 */
function HomeworkList({ onPick }: { onPick: (s: ChatContextSelection) => void }) {
  const { enrolledCourses, enrolments, level, loading } = useEnrolments();
  const scope = courseScopeFilter(enrolledCourses, enrolments, { boardless: true });
  const {
    data: rows,
    error,
    refetch,
  } = useQuery({
    queryKey: [...CHAT_KEY, "picker", "homework", scope, level],
    enabled: !loading,
    queryFn: async () => {
      if (!scope) return [];
      let q = supabase
        .from("resources")
        .select("id, title, subject, created_at")
        .eq("kind", "homework")
        .in("subject", enrolledCourses as SubjectV[])
        .or(scope);
      // Null (not yet set) filters nothing, as on the homework page.
      if (level) q = q.eq("level", level);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(PICKER_LIMIT);
      // Thrown: an error is not "No homework set yet".
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  if (error) return <PickerError error={error} onRetry={() => void refetch()} />;

  return (
    <PickerShell>
      {rows === undefined ? (
        <Spinner className="py-4" />
      ) : rows.length === 0 ? (
        <EmptyRow>No tasks set yet.</EmptyRow>
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
                label: `Task: ${r.title}`,
              })
            }
          />
        ))
      )}
    </PickerShell>
  );
}

type QuizRow = { id: string; title: string; subject: SubjectV | null; created_at: string };

/**
 * Published quizzes from the student's own courses. A quiz on a spec point
 * carries its level and board through that point's topic, so those are read
 * as the topics of the student's courses; a quiz with no spec point carries a
 * subject and nothing else, so it is matched on subject.
 */
function QuizList({ onPick }: { onPick: (s: ChatContextSelection) => void }) {
  const { enrolledCourses, enrolments, level, loading } = useEnrolments();
  const scope = courseScopeFilter(enrolledCourses, enrolments, { boardless: false });
  const {
    data: rows,
    error,
    refetch,
  } = useQuery({
    queryKey: [...CHAT_KEY, "picker", "quizzes", scope, level],
    enabled: !loading,
    queryFn: async (): Promise<QuizRow[]> => {
      if (!scope) return [];
      const subjects = enrolledCourses as SubjectV[];
      let topicsQuery = supabase.from("topics").select("id").in("subject", subjects).or(scope);
      if (level) topicsQuery = topicsQuery.eq("level", level);
      const [topics, unpinned] = await Promise.all([
        topicsQuery,
        supabase
          .from("mcq_sets")
          .select("id, title, subject, created_at")
          .eq("published", true)
          .is("spec_point_id", null)
          .in("subject", subjects)
          .order("created_at", { ascending: false })
          .limit(PICKER_LIMIT),
      ]);
      if (topics.error) throw new Error(topics.error.message);
      if (unpinned.error) throw new Error(unpinned.error.message);
      const pinned = await selectIn<QuizRow>(
        (topics.data ?? []).map((t) => t.id),
        (batch) =>
          supabase
            .from("mcq_sets")
            .select("id, title, subject, created_at, spec_points!inner(topic_id)")
            .eq("published", true)
            .in("spec_points.topic_id", batch)
            .order("created_at", { ascending: false })
            .limit(PICKER_LIMIT),
      );
      return [...pinned, ...(unpinned.data ?? [])]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, PICKER_LIMIT);
    },
  });

  if (error) return <PickerError error={error} onRetry={() => void refetch()} />;

  return (
    <PickerShell>
      {rows === undefined ? (
        <Spinner className="py-4" />
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
