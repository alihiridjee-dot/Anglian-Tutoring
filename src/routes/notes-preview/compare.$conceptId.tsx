import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { NoteView } from "@/components/notes/NoteView";
import { findDraft } from "@/lib/notes/draftNotes";
import { NOTE_BOARDS, type NoteBoard } from "@/lib/notes/noteFormat";

// DEV ONLY — the same note from two writers, side by side, for a blind comparison.
type Search = { board: NoteBoard; left: string; right: string };

export const Route = createFileRoute("/notes-preview/compare/$conceptId")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    board: (NOTE_BOARDS as readonly string[]).includes(search.board as string) ? (search.board as NoteBoard) : "aqa",
    left: typeof search.left === "string" ? search.left : "trial/a",
    right: typeof search.right === "string" ? search.right : "trial/b",
  }),
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  loaderDeps: ({ search }) => ({ left: search.left, right: search.right }),
  loader: async ({ params, deps }) => {
    const a = findDraft(deps.left, params.conceptId);
    const b = findDraft(deps.right, params.conceptId);
    if (!a || !b) throw notFound();
    return { a: await a.load(), b: await b.load() };
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Compare: ${loaderData?.a.title ?? "note"}` }] }),
  component: Compare,
});

const LABEL: Record<NoteBoard, string> = { aqa: "AQA", edexcel: "Edexcel", ocr: "OCR" };
const TRIAL = ["bio-001", "bio-008", "bio-012", "bio-013", "bio-015"];
const SET_LABEL: Record<string, string> = {
  "trial/a": "Sonnet — first draft",
  "trial/b": "Opus — first draft",
  "trial/c": "Sonnet — lighter style",
};

function Compare() {
  const { a, b } = Route.useLoaderData();
  const { board, left, right } = Route.useSearch();
  const { conceptId } = Route.useParams();
  const boards = NOTE_BOARDS.filter((x) => a.boards[x] || b.boards[x]);

  return (
    <div className="page-aurora relative min-h-screen">
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/notes-preview" className="chip">All drafts</Link>
          {TRIAL.map((id) => (
            <Link key={id} to="/notes-preview/compare/$conceptId" params={{ conceptId: id }} search={{ board, left, right }} className={`chip ${id === conceptId ? "chip-solid" : ""}`}>
              {id.replace("bio-0", "Note ")}
            </Link>
          ))}
          <span className="ml-auto flex flex-wrap gap-2" role="group" aria-label="Exam board">
            {boards.map((x) => (
              <Link key={x} to="/notes-preview/compare/$conceptId" params={{ conceptId }} search={{ board: x, left, right }} className={`chip ${x === board ? "chip-solid" : ""}`}>
                {LABEL[x]}
              </Link>
            ))}
          </span>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {([[SET_LABEL[left] ?? left, a], [SET_LABEL[right] ?? right, b]] as const).map(([label, note]) => (
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
