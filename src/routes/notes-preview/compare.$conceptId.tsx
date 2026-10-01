import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { NoteView } from "@/components/notes/NoteView";
import { findDraft } from "@/lib/notes/draftNotes";
import { NOTE_BOARDS, type NoteBoard } from "@/lib/notes/noteFormat";

// DEV ONLY — the same note from two writers, side by side, for a blind comparison.
export const Route = createFileRoute("/notes-preview/compare/$conceptId")({
  validateSearch: (search: Record<string, unknown>): { board: NoteBoard } => ({
    board: (NOTE_BOARDS as readonly string[]).includes(search.board as string) ? (search.board as NoteBoard) : "aqa",
  }),
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  loader: async ({ params }) => {
    const a = findDraft("trial/a", params.conceptId);
    const b = findDraft("trial/b", params.conceptId);
    if (!a || !b) throw notFound();
    return { a: await a.load(), b: await b.load() };
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Compare: ${loaderData?.a.title ?? "note"}` }] }),
  component: Compare,
});

const LABEL: Record<NoteBoard, string> = { aqa: "AQA", edexcel: "Edexcel", ocr: "OCR" };
const TRIAL = ["bio-001", "bio-008", "bio-012", "bio-013", "bio-015"];

function Compare() {
  const { a, b } = Route.useLoaderData();
  const { board } = Route.useSearch();
  const { conceptId } = Route.useParams();
  const boards = NOTE_BOARDS.filter((x) => a.boards[x] || b.boards[x]);

  return (
    <div className="page-aurora relative min-h-screen">
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/notes-preview" className="chip">All drafts</Link>
          {TRIAL.map((id) => (
            <Link key={id} to="/notes-preview/compare/$conceptId" params={{ conceptId: id }} search={{ board }} className={`chip ${id === conceptId ? "chip-solid" : ""}`}>
              {id.replace("bio-0", "Note ")}
            </Link>
          ))}
          <span className="ml-auto flex flex-wrap gap-2" role="group" aria-label="Exam board">
            {boards.map((x) => (
              <Link key={x} to="/notes-preview/compare/$conceptId" params={{ conceptId }} search={{ board: x }} className={`chip ${x === board ? "chip-solid" : ""}`}>
                {LABEL[x]}
              </Link>
            ))}
          </span>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {([["Writer A", a], ["Writer B", b]] as const).map(([label, note]) => (
            <section key={label} className="min-w-0 space-y-3">
              <h2 className="font-display text-2xl font-extrabold">{label}</h2>
              {note.boards[board] ? <NoteView note={note} board={board} /> : <p className="font-bold">No {LABEL[board]} layer in this version.</p>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
