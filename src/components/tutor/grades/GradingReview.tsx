import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { toast } from "sonner";
import { Plus, Search, Trash2, X } from "lucide-react";
import { EmptyState, ErrorNote, SegmentedToggle, Spinner } from "@/components/Shared";
import { useGradingQueue, type QueueSubmission } from "@/hooks/data/useGradingQueue";
import { useWindowedRows } from "@/hooks/useWindowedRows";
import { cn } from "@/lib/utils";
import {
  cohortLabel,
  facetsFor,
  markStatusOf,
  matchesName,
  matchesSheetFilters,
  parseSet,
  timeLeft,
  toggleInCsv,
  type Course,
  type FacetKey,
  type GradesSearch,
  type MarkStatus,
  type SheetFilters,
} from "@/lib/homeworkReview";
import { FilterChips } from "./FilterChips";
import { SubmissionPane } from "./SubmissionPane";

/**
 * Incoming work: the model has marked it, a tutor checks the marking.
 *
 * Master–detail, because this job is about one child at a time. The rail on the
 * left answers "whose work?", the pane on the right is that work, and
 * "Finalize & next" walks the rail without the tutor touching it. Nothing
 * navigates away, so the search, the group and the place in the list all
 * survive every save.
 */

const ROW_HEIGHT = 52;

/** Tier is left out: handed-in work is filtered by the course it was set for. */
const FACETS: { key: FacetKey; label: string }[] = [
  { key: "subject", label: "Subject" },
  { key: "level", label: "Level" },
  { key: "board", label: "Board" },
];
const NO_COURSE: Course = {};
const courseOf = (s: QueueSubmission): Course => s.resource ?? NO_COURSE;

/** Soonest to publish first; work with no clock at all (never marked) before everything. */
const clock = (s: QueueSubmission) =>
  s.graded_at ? Infinity : s.release_at ? new Date(s.release_at).getTime() : -Infinity;

export function GradingReview({
  userId,
  search,
  setSearch,
}: {
  userId: string | null;
  search: GradesSearch;
  setSearch: (changes: Partial<GradesSearch>) => void;
}) {
  const queue = useGradingQueue();
  const status: MarkStatus = search.status ?? "pending";
  // The name being searched for stays out of the URL: it is a child's name, and
  // an address bar is copied, logged and synced in ways a text box is not.
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const searchRef = useRef<HTMLInputElement>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);

  const inGroup = (studentId: string) =>
    !search.group || (queue.students.get(studentId)?.groups.has(search.group) ?? false);

  // The same three filters as Outgoing, under the same URL keys, so a course
  // picked on one side is still picked on the other. Tier never applies here.
  const filters = useMemo(
    (): SheetFilters => ({ subject: search.subject, level: search.level, board: search.board }),
    [search.subject, search.level, search.board],
  );

  // Group and course first, status second: the three counts describe what is left.
  const inScope = useMemo(
    () => queue.submissions.filter((s) => inGroup(s.student_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inGroup reads exactly these
    [queue.submissions, queue.students, search.group],
  );
  const scoped = useMemo(
    () => inScope.filter((s) => matchesSheetFilters(courseOf(s), filters)),
    [inScope, filters],
  );
  const courses = useMemo(() => inScope.map(courseOf), [inScope]);
  const counts = useMemo(() => {
    const c: Record<MarkStatus, number> = { pending: 0, edited: 0, finalized: 0 };
    for (const s of scoped) c[markStatusOf(s)]++;
    return c;
  }, [scoped]);

  /** Every submission in this segment, in the order "next" walks them. */
  const ordered = useMemo(() => {
    const inSegment = scoped.filter((s) => markStatusOf(s) === status);
    if (status === "finalized")
      return inSegment.sort((a, b) => (b.graded_at ?? "").localeCompare(a.graded_at ?? ""));
    // Keep a student's work together, and put the student with the nearest
    // deadline first — so walking the list is also working in order of urgency.
    const soonest = new Map<string, number>();
    for (const s of inSegment)
      soonest.set(s.student_id, Math.min(soonest.get(s.student_id) ?? Infinity, clock(s)));
    return inSegment.sort(
      (a, b) =>
        soonest.get(a.student_id)! - soonest.get(b.student_id)! ||
        a.student_id.localeCompare(b.student_id) ||
        clock(a) - clock(b),
    );
  }, [scoped, status]);

  const rail = useMemo(() => {
    const rows = new Map<
      string,
      { id: string; name: string; count: number; next: QueueSubmission | null }
    >();
    for (const s of ordered) {
      const row = rows.get(s.student_id);
      if (row) row.count++;
      else
        rows.set(s.student_id, {
          id: s.student_id,
          name: queue.students.get(s.student_id)?.name ?? `Student ${s.student_id.slice(0, 8)}`,
          count: 1,
          next: s,
        });
    }
    if (!deferredQuery) return [...rows.values()];
    // Searching looks across the whole roster, not only students with work in
    // this segment — it is also how a student is found to be put in a group.
    const found = [...queue.students.values()]
      .filter((st) => inGroup(st.id) && matchesName(st.name, deferredQuery))
      .map((st) => rows.get(st.id) ?? { id: st.id, name: st.name, count: 0, next: null });
    return found.sort(
      (a, b) => Number(b.count > 0) - Number(a.count > 0) || a.name.localeCompare(b.name),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inGroup reads search.group
  }, [ordered, queue.students, deferredQuery, search.group]);

  const windowed = useWindowedRows<HTMLDivElement>(rail.length, ROW_HEIGHT);

  const current =
    queue.submissions.find((s) => s.id === search.sub) ??
    (search.student ? null : (ordered[0] ?? null));
  const studentId = search.student ?? current?.student_id;
  const student = studentId ? queue.students.get(studentId) : undefined;

  const goTo = (s: QueueSubmission | null | undefined) =>
    setSearch({ sub: s?.id, student: s?.student_id });
  const step = (delta: number) => {
    const at = current ? ordered.findIndex((s) => s.id === current.id) : -1;
    const next = ordered[at + delta];
    if (next) goTo(next);
  };

  // Pin whatever opened by default into the URL. Saving a draft moves a
  // submission from Pending to Edited; if "open" still meant "first in the
  // list", the pane would jump to a different child mid-correction.
  const pinId = !search.sub && !search.student ? ordered[0]?.id : undefined;
  useEffect(() => {
    if (pinId) goTo(ordered[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id alone
  }, [pinId]);

  // "/" jumps to search from anywhere on the tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (!typing && !e.metaKey && !e.ctrlKey && (e.key === "j" || e.key === "k")) {
        e.preventDefault();
        step(e.key === "j" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (queue.loading) return <Spinner label="Loading submissions" className="py-16" />;
  if (queue.error) return <ErrorNote error={queue.error} />;
  if (queue.submissions.length === 0)
    return (
      <EmptyState
        title="No homework handed in yet"
        body="Marked work arrives here for you to check before students see it."
        mascot="books"
      />
    );

  const selectedGroup = queue.groups.find((g) => g.id === search.group);

  return (
    <div className="space-y-4">
      <div className="premium-card rounded-2xl p-4 space-y-2.5">
        {FACETS.map(({ key, label }) => (
          <FilterChips
            key={key}
            label={label}
            facets={facetsFor(courses, filters, key)}
            selected={parseSet(filters[key])}
            onToggle={(value) =>
              setSearch({
                [key]: toggleInCsv(filters[key], value),
                sub: undefined,
                student: undefined,
              })
            }
          />
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] items-start">
        <div className="premium-card rounded-2xl overflow-hidden">
          <div className="space-y-3 p-4">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && rail[0]) {
                    goTo(rail[0].next);
                    if (!rail[0].next) setSearch({ student: rail[0].id, sub: undefined });
                  }
                  if (e.key === "Escape") setQuery("");
                }}
                placeholder="Find a student"
                aria-label="Find a student"
                className="premium-input h-10 w-full pl-9 pr-9 text-sm"
              />
              {!query && (
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                  /
                </kbd>
              )}
            </label>

            <div className="flex items-center gap-2">
              <select
                value={search.group ?? ""}
                onChange={(e) => setSearch({ group: e.target.value || undefined })}
                aria-label="Group"
                className="premium-input h-9 min-w-0 flex-1 px-2 text-sm"
              >
                <option value="">All students</option>
                {queue.groups.some((g) => g.kind === "manual") && (
                  <optgroup label="Your groups">
                    {queue.groups
                      .filter((g) => g.kind === "manual")
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.size})
                        </option>
                      ))}
                  </optgroup>
                )}
                <optgroup label="Courses">
                  {queue.groups
                    .filter((g) => g.kind === "cohort")
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.size})
                      </option>
                    ))}
                </optgroup>
              </select>
              {selectedGroup?.kind === "manual" ? (
                <button
                  type="button"
                  title={`Delete ${selectedGroup.name}`}
                  aria-label={`Delete group ${selectedGroup.name}`}
                  className="icon-tile tint-rose size-9 shrink-0 cursor-pointer"
                  onClick={async () => {
                    try {
                      await queue.deleteGroup(selectedGroup.id);
                      setSearch({ group: undefined });
                      toast.success(`Deleted ${selectedGroup.name}`);
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "Could not delete the group",
                      );
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : (
                <button
                  type="button"
                  title="New group"
                  aria-label="New group"
                  onClick={() => setNewGroup(newGroup === null ? "" : null)}
                  className="icon-tile size-9 shrink-0 cursor-pointer"
                >
                  {newGroup === null ? <Plus className="size-4" /> : <X className="size-4" />}
                </button>
              )}
            </div>

            {newGroup !== null && (
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newGroup.trim()) return;
                  try {
                    const id = await queue.createGroup(newGroup, userId);
                    setNewGroup(null);
                    setSearch({ group: id });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not create the group");
                  }
                }}
              >
                <input
                  autoFocus
                  value={newGroup}
                  maxLength={60}
                  onChange={(e) => setNewGroup(e.target.value)}
                  placeholder="Group name"
                  aria-label="Group name"
                  className="premium-input h-9 min-w-0 flex-1 px-3 text-sm"
                />
                <button type="submit" className="btn-solid h-9 rounded-lg px-3 text-sm font-bold">
                  Create
                </button>
              </form>
            )}

            <SegmentedToggle
              label="Marking status"
              layoutId="incoming-status"
              value={status}
              onChange={(v) =>
                setSearch({ status: v as MarkStatus, sub: undefined, student: undefined })
              }
              items={[
                { value: "pending", label: "Pending", count: counts.pending, tint: "tint-amber" },
                { value: "edited", label: "Edited", count: counts.edited, tint: "tint-primary" },
                {
                  value: "finalized",
                  label: "Final",
                  count: counts.finalized,
                  tint: "tint-emerald",
                },
              ]}
            />
          </div>

          <div
            ref={windowed.ref}
            className="max-h-[55vh] overflow-y-auto border-t border-border"
            role="listbox"
            aria-label="Students"
          >
            <div style={{ height: windowed.before }} />
            {rail.slice(windowed.start, windowed.end).map((row) => {
              const active = row.id === studentId;
              const left = status !== "finalized" ? timeLeft(row.next?.release_at ?? null) : null;
              const r = row.next?.resource;
              const course =
                r?.subject && r.board ? cohortLabel(r.subject, r.board, r.level) : null;
              return (
                <button
                  key={row.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setSearch({ student: row.id, sub: row.next?.id })}
                  style={{ height: ROW_HEIGHT }}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border px-4 text-left text-sm hover:bg-muted/40",
                    active && "bg-[color-mix(in_oklab,var(--tint)_9%,transparent)]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{row.name}</span>
                    {(course || left) && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[course, left && `Publishes in ${left}`].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  {row.count > 0 && <span className="chip numeral">{row.count}</span>}
                </button>
              );
            })}
            <div style={{ height: windowed.after }} />
            {rail.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No students match.
              </p>
            )}
          </div>
        </div>

        {studentId ? (
          <SubmissionPane
            // Remount per submission: the marking state belongs to one piece of work.
            key={current?.id ?? studentId}
            userId={userId}
            studentId={studentId}
            studentName={student?.name ?? `Student ${studentId.slice(0, 8)}`}
            submission={current && current.student_id === studentId ? current : null}
            theirs={queue.submissions.filter((s) => s.student_id === studentId)}
            manualGroups={queue.groups.filter((g) => g.kind === "manual")}
            memberOf={student?.groups ?? new Set()}
            onToggleGroup={async (groupId, member) => {
              try {
                await queue.setMembership(groupId, studentId, member);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not update the group");
              }
            }}
            onOpen={goTo}
            onSaved={(id, changes, advance) => {
              // Work out where "next" is before the save moves this one out of the list.
              const at = ordered.findIndex((s) => s.id === id);
              const next = ordered[at + 1] ?? ordered[at - 1];
              queue.patchSubmission(id, changes);
              if (advance) goTo(next && next.id !== id ? next : null);
            }}
          />
        ) : (
          <EmptyState
            title="All caught up"
            body="No marks are waiting in this view."
            mood="happy"
          />
        )}
      </div>
    </div>
  );
}
