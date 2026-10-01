import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, ClipboardList, Clock, Eye, Loader2, Pencil, Trash2 } from "lucide-react";

import { ErrorNote, Spinner } from "@/components/Shared";
import { HomeworkForm } from "@/components/tutor/HomeworkForm";
import { deleteHomework } from "@/lib/homework/homework.functions";
import { useHomeworkLibrary, useHomeworkLibraryCounts } from "@/hooks/data/useHomework";
import { SUBJECT_LABEL } from "@/lib/curriculum/subjectTheme";
import type { Homework, HomeworkOrigin } from "@/lib/homework/types";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";

/**
 * Every homework that exists, for the tutor who has to keep it honest.
 *
 * This used to be headed "Homework you've set", which stopped being true the
 * moment the planner began writing a sheet for each spec point: those rows are
 * created under whichever student's week first reached the topic, so the list
 * was showing a tutor hundreds of sheets they had never seen, each with a
 * "delete for everyone" button and no way to correct a single word of one.
 *
 * So it is a library, filtered by who wrote it, and each row can be previewed,
 * edited or removed. Editing is the point: a generated sheet with a wrong unit
 * in question three is now a two-minute fix rather than a choice between
 * leaving it wrong and deleting it for the whole cohort.
 */

type Filter = "all" | HomeworkOrigin;

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  tutor: "Set by tutors",
  generated: "Generated practice",
};

export function HomeworkLibrary({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("tutor");

  // Counted and paged on the server: there's a generated sheet for every spec
  // point, and one read of them all stopped at 1,000 rows (S-17b).
  const { data: counts } = useHomeworkLibraryCounts();
  const library = useHomeworkLibrary({ origin: filter, enabled: open });
  const loading = library.isPending;

  // A row that moved between pages while they were read shouldn't show twice.
  const shown = useMemo(() => {
    const byId = new Map<string, Homework>();
    for (const hw of (library.data?.pages ?? []).flat()) if (!byId.has(hw.id)) byId.set(hw.id, hw);
    return [...byId.values()];
  }, [library.data]);
  const left = Math.max(0, (counts?.[filter] ?? 0) - shown.length);

  return (
    <div className="premium-card mt-8 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="text-muted-foreground size-4" />
          Homework library
          <span className="bg-secondary text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px]">
            {counts ? counts.all : "…"}
          </span>
        </span>
        <ChevronDown
          className={`text-muted-foreground size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-border border-t p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap gap-2">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`chip tap-target ${filter === key ? "chip-solid" : ""}`}
              >
                {FILTER_LABEL[key]}
                {counts ? ` (${counts[key]})` : ""}
              </button>
            ))}
          </div>

          {library.error ? (
            <ErrorNote error={library.error} onRetry={() => void library.refetch()} />
          ) : loading ? (
            <Spinner label="Loading homework" className="py-8" />
          ) : shown.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {filter === "tutor"
                ? "You haven't set any homework yet — use the form above to post the first one."
                : "Nothing here yet."}
            </p>
          ) : (
            <>
              <ul className="divide-border divide-y">
                {shown.map((hw) => (
                  <LibraryRow key={hw.id} hw={hw} userId={userId} onChanged={onChanged} />
                ))}
              </ul>
              {library.hasNextPage && (
                <button
                  type="button"
                  onClick={() => void library.fetchNextPage()}
                  disabled={library.isFetchingNextPage}
                  className="btn-soft mx-auto mt-4 flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
                >
                  {library.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
                  Show more{left > 0 ? ` (${left} left)` : ""}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LibraryRow({
  hw,
  userId,
  onChanged,
}: {
  hw: Homework;
  userId: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Taxonomy the edit form drives; seeded from the row and then owned by the
  // form's own selects.
  const [subject, setSubject] = useState<SubjectV>((hw.subject as SubjectV) ?? "biology");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [level, setLevel] = useState<LevelV>("gcse");

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteHomework({ data: { homeworkId: hw.id } });
      toast.success("Homework deleted for everyone");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete homework");
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip">{SUBJECT_LABEL[hw.subject] ?? hw.subject}</span>
        {hw.origin === "generated" && <span className="chip">Generated</span>}
        <span className="text-sm font-medium">{hw.title}</span>
        {hw.due_at && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Clock className="size-3" /> Due {new Date(hw.due_at).toLocaleDateString()}
          </span>
        )}

        {confirming ? (
          <span className="ml-auto inline-flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Delete for all students?</span>
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="bg-destructive inline-flex h-11 sm:h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              <Trash2 className="size-3" />
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="border-border hover:bg-muted/50 h-11 sm:h-7 rounded-md border px-2.5 text-xs font-medium disabled:opacity-60"
            >
              Cancel
            </button>
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-3">
            <Link
              to="/homework/$homeworkId"
              params={{ homeworkId: hw.id }}
              className="text-muted-foreground hover:text-foreground inline-flex min-h-11 sm:min-h-0 items-center gap-1 text-xs"
            >
              <Eye className="size-3.5" />
              Preview
            </Link>
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className="text-muted-foreground hover:text-foreground inline-flex min-h-11 sm:min-h-0 items-center gap-1 text-xs"
            >
              <Pencil className="size-3.5" />
              {editing ? "Close" : "Edit"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-muted-foreground hover:text-destructive inline-flex min-h-11 sm:min-h-0 items-center gap-1 text-xs"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </span>
        )}
      </div>

      {editing && (
        <div className="border-border mt-4 rounded-xl border p-4">
          <HomeworkForm
            userId={userId}
            taxonomy={{ subject, setSubject, board, setBoard, level, setLevel }}
            editing={{
              id: hw.id,
              onDone: () => {
                setEditing(false);
                onChanged();
              },
            }}
          />
        </div>
      )}
    </li>
  );
}
