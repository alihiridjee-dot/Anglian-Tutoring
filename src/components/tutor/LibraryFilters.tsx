import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { inputCls } from "@/components/tutor/Field";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { boardLabel, levelLabel } from "@/lib/curriculum/courseSummary";
import {
  SUBJECTS,
  BOARDS,
  LEVELS,
  type SubjectV,
  type BoardV,
  type LevelV,
} from "@/lib/curriculum/taxonomy";
import {
  NO_FILTER,
  courseParts,
  isFiltered,
  type LibraryFilter,
} from "@/lib/curriculum/libraryFilter";

type TopicRow = {
  id: string;
  code: string | null;
  title: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  sort_order: number;
};

/** Every topic heading on every course — a few hundred rows, read once. */
function useTopicIndex() {
  return useQuery({
    queryKey: ["topic-index"],
    queryFn: async (): Promise<TopicRow[]> => {
      const { data, error } = await supabase
        .from("topics")
        .select("id, code, title, subject, board, level, sort_order")
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10 * 60_000,
  });
}

const rank = (list: readonly { value: string }[], v: string) =>
  list.findIndex((x) => x.value === v);

/** "Topic 3: Genetics" whether or not the title already carries its number. */
const topicLabel = (t: TopicRow) =>
  !t.code || t.title.startsWith(t.code) ? t.title : `${t.code}: ${t.title}`;

export function LibraryFilters({
  value,
  onChange,
  searchLabel,
}: {
  value: LibraryFilter;
  onChange: (next: LibraryFilter) => void;
  /** What the search box finds, e.g. "Search tasks by title or spec code". */
  searchLabel: string;
}) {
  const { data: topics = [] } = useTopicIndex();

  // Only courses that exist, and for the subject picked when there is one.
  const courses = useMemo(() => {
    const seen = new Map<string, { board: BoardV; level: LevelV }>();
    for (const t of topics) {
      if (value.subject && t.subject !== value.subject) continue;
      seen.set(`${t.board}:${t.level}`, { board: t.board, level: t.level });
    }
    return [...seen.entries()]
      .sort(
        ([, a], [, b]) =>
          rank(BOARDS, a.board) - rank(BOARDS, b.board) ||
          rank(LEVELS, a.level) - rank(LEVELS, b.level),
      )
      .map(([key, c]) => ({ key, label: `${boardLabel(c.board)} ${levelLabel(c.level)}` }));
  }, [topics, value.subject]);

  // A topic belongs to one subject on one course, so it needs both.
  const course = courseParts(value.course);
  const courseTopics =
    value.subject && course
      ? topics.filter(
          (t) =>
            t.subject === value.subject && t.board === course.board && t.level === course.level,
        )
      : [];

  return (
    <div className="mb-4 space-y-3">
      <label className="relative block">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          type="search"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className={`${inputCls} pl-9`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Subject">
        <button
          type="button"
          aria-pressed={value.subject === null}
          onClick={() => onChange({ ...value, subject: null, topicId: null })}
          className={`chip tap-target ${value.subject === null ? "chip-solid" : ""}`}
        >
          All subjects
        </button>
        {SUBJECTS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={value.subject === s.value}
            onClick={() =>
              onChange({
                ...value,
                subject: s.value,
                topicId: null,
                // A course this subject isn't taught on would match nothing.
                course: topics.some(
                  (t) => t.subject === s.value && `${t.board}:${t.level}` === value.course,
                )
                  ? value.course
                  : null,
              })
            }
            className={`chip tap-target ${SUBJECT_TINT[s.value]} ${
              value.subject === s.value ? "chip-solid" : ""
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          aria-label="Course"
          value={value.course ?? ""}
          onChange={(e) => onChange({ ...value, course: e.target.value || null, topicId: null })}
          className={`${inputCls} sm:max-w-xs`}
        >
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        {courseTopics.length > 0 && (
          <select
            aria-label="Topic"
            value={value.topicId ?? ""}
            onChange={(e) => onChange({ ...value, topicId: e.target.value || null })}
            className={`${inputCls} min-w-0 sm:flex-1`}
          >
            <option value="">All topics</option>
            {courseTopics.map((t) => (
              <option key={t.id} value={t.id}>
                {topicLabel(t)}
              </option>
            ))}
          </select>
        )}
        {isFiltered(value) && (
          <button
            type="button"
            onClick={() => onChange(NO_FILTER)}
            className="btn-soft inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold sm:pointer-fine:h-10"
          >
            <X className="size-4" aria-hidden />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
