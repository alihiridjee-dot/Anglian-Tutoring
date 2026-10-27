import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { NoteView } from "@/components/notes/NoteView";
import { findDraft } from "@/lib/notes/draftNotes";
import { NOTE_BOARDS, NOTE_COURSE, type NoteBoard } from "@/lib/notes/noteFormat";

// DEV ONLY — one drafted note, shown as a student on the chosen board would see it.
export const Route = createFileRoute("/notes-preview/$conceptId")({
  validateSearch: (search: Record<string, unknown>): { set: string; board: NoteBoard } => ({
    set: typeof search.set === "string" ? search.set : "drafts",
    board: (NOTE_BOARDS as readonly string[]).includes(search.board as string)
      ? (search.board as NoteBoard)
      : "aqa",
  }),
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  loaderDeps: ({ search }) => ({ set: search.set }),
  loader: async ({ params, deps }) => {
    const ref = findDraft(deps.set, params.conceptId);
    if (!ref) throw notFound();
    return ref.load();
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.title ?? "Note"} — draft` }] }),
  component: DraftNote,
});

const LABEL = Object.fromEntries(
  NOTE_BOARDS.map((b) => [b, `${NOTE_COURSE[b].board} ${NOTE_COURSE[b].level}`]),
) as Record<NoteBoard, string>;

function DraftNote() {
  const note = Route.useLoaderData();
  const { set, board } = Route.useSearch();
  const boards = NOTE_BOARDS.filter((b) => note.boards[b]);
  const shown = boards.includes(board) ? board : boards[0];

  return (
    <div className="page-aurora relative min-h-screen">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:py-12">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/notes-preview" className="chip">
            All drafts
          </Link>
          <span className="chip chip-solid tint-amber">Draft — {note.meta.status}</span>
          <span className="ml-auto flex flex-wrap gap-2" role="group" aria-label="Exam board">
            {boards.map((b) => (
              <Link
                key={b}
                to="/notes-preview/$conceptId"
                params={{ conceptId: note.concept_id }}
                search={{ set, board: b }}
                aria-current={b === shown ? "page" : undefined}
                className={`chip ${b === shown ? "chip-solid" : ""}`}
              >
                {LABEL[b]}
              </Link>
            ))}
          </span>
        </div>
        <NoteView note={note} board={shown} />
      </div>
    </div>
  );
}
