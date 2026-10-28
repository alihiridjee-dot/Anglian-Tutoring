import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageHeader, SciBlock, SciText } from "@/components/Shared";
import { QuestionFigure } from "@/components/QuestionFigure";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { checkFigure, checkReply } from "@/lib/figures/figureCheck";
import { FIGURE_EXAMPLES, type FigureRequest } from "@/lib/figures/figurePrompt";

// DEV ONLY — the figure prompt's worked examples and the DeepSeek trial's
// results (scripts/figure-trial.ts), each on a question card with the
// checker's verdict.
export const Route = createFileRoute("/figures-preview")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Question figures — Anglia Educate" }] }),
  component: FiguresPreview,
});

type Attempt = {
  attempt: number;
  reply: unknown;
  problems: string[];
  status: string | null;
  cost: number;
  ms: number;
};
type Trial = { name: string; request: FigureRequest; attempts: Attempt[] };

// Behind DEV so the trial output never ships in a production chunk.
const trials = Object.values(
  import.meta.env.DEV
    ? import.meta.glob<Trial>("/scripts/figures/out/*.json", { eager: true, import: "default" })
    : {},
).sort((a, b) => a.name.localeCompare(b.name));

function FiguresPreview() {
  return (
    <div className="page-aurora relative min-h-screen">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:py-12">
        <span className="chip chip-solid tint-amber">Question figures — development only</span>
        <PageHeader eyebrow="DeepSeek figure prompt" title="Figures on question cards" />
        <h2>Worked examples</h2>
        {FIGURE_EXAMPLES.map((e) => (
          <Card
            key={e.name}
            name={e.name}
            request={e.request}
            attempts={[{ attempt: 1, reply: e.reply, problems: [], status: "ok", cost: 0, ms: 0 }]}
          />
        ))}
        <h2>DeepSeek trial</h2>
        {trials.length === 0 ? (
          <p className="font-bold">No trial results yet: run bun scripts/figure-trial.ts run</p>
        ) : null}
        {trials.map((t) => (
          <Card key={t.name} name={t.name} request={t.request} attempts={t.attempts} />
        ))}
      </div>
    </div>
  );
}

function Card({
  name,
  request,
  attempts,
}: {
  name: string;
  request: FigureRequest;
  attempts: Attempt[];
}) {
  const last = attempts[attempts.length - 1];
  const reply = last.reply as { svg?: string; alt?: string; reason?: string } | null;
  const verdict = checkReply(last.reply, request.brief);
  const spent = attempts.reduce((s, a) => s + a.cost, 0);
  return (
    <section
      className={`premium-card space-y-4 p-4 sm:p-5 ${SUBJECT_TINT[request.subject] ?? "tint-primary"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip chip-solid">{name}</span>
        <span className="chip">{request.brief.kind}</span>
        <span className="chip">
          {verdict.status ?? "unreadable"} · {attempts.length}{" "}
          {attempts.length === 1 ? "try" : "tries"}
        </span>
        {spent ? <span className="chip">${spent.toFixed(4)}</span> : null}
      </div>
      <SciBlock text={request.question} className="font-display text-lg break-words" />
      {verdict.figure ? (
        <QuestionFigure svg={verdict.figure.svg} alt={verdict.figure.alt} brief={request.brief} />
      ) : reply?.svg ? (
        <Rejected svg={reply.svg} />
      ) : null}
      {request.options ? (
        <ol className="space-y-2">
          {request.options.map((o, i) => (
            <li
              key={i}
              className="rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm"
            >
              <span className="font-mono text-xs mr-2 text-muted-foreground">
                {String.fromCharCode(65 + i)}.
              </span>
              <SciText text={o} />
            </li>
          ))}
        </ol>
      ) : null}
      {verdict.status && verdict.status !== "ok" ? (
        <p className="font-bold">
          {verdict.status}: {reply?.reason}
        </p>
      ) : null}
      {attempts.map((a) =>
        a.problems.length ? (
          <div key={a.attempt} className="rounded-xl border border-border p-3">
            <p className="font-bold">Try {a.attempt}: the checker rejected it</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {a.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </section>
  );
}

/** A rejected figure, rebuilt by the checker so only its allowed parts are drawn. Never shown to students. */
function Rejected({ svg }: { svg: string }) {
  const clean = checkFigure(svg).svg;
  if (!clean) return <p className="font-bold">Rejected, and too broken to draw.</p>;
  return (
    <figure className="rounded-2xl border-2 border-dashed border-[color:var(--destructive)] p-3">
      <figcaption className="mb-2 font-bold">Rejected: students never see this</figcaption>
      <div dangerouslySetInnerHTML={{ __html: clean }} />
    </figure>
  );
}
