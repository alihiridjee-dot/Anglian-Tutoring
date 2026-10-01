import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageHeader } from "@/components/Shared";
import { draftNotes } from "@/lib/notes/draftNotes";
import biologyMap from "../../../scripts/notes/concepts/gcse-biology.json";

// DEV ONLY — the list of drafted revision notes, for writing and review.
export const Route = createFileRoute("/notes-preview/")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Draft notes — Anglia Educate" }] }),
  component: DraftList,
});

const SET_LABEL: Record<string, string> = { drafts: "Drafts", "trial/a": "Writer A", "trial/b": "Writer B" };

function DraftList() {
  const sets = [...new Set(draftNotes.map((d) => d.set))].sort();
  const titleOf = (id: string) => biologyMap.concepts.find((c) => c.id === id)?.title ?? id;

  return (
    <div className="page-aurora relative min-h-screen">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:py-12">
        <span className="chip chip-solid tint-amber">Draft notes — development only</span>
        <PageHeader eyebrow="GCSE revision notes" title="Drafts for review" />
        {sets.length === 0 ? <p className="font-bold">No drafts yet.</p> : null}
        {sets.map((set) => (
          <section key={set} className="premium-card space-y-3 p-5">
            <h2 className="font-display text-xl font-extrabold">{SET_LABEL[set] ?? set}</h2>
            <ul className="space-y-2">
              {draftNotes
                .filter((d) => d.set === set)
                .sort((a, b) => a.conceptId.localeCompare(b.conceptId))
                .map((d) => (
                  <li key={d.conceptId}>
                    <Link
                      to="/notes-preview/$conceptId"
                      params={{ conceptId: d.conceptId }}
                      search={{ set, board: "aqa" }}
                      className="font-bold underline decoration-2 underline-offset-4"
                    >
                      {titleOf(d.conceptId)}
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
