import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageHeader, SciBlock, SciText } from "@/components/Shared";
import { QuestionFigure } from "@/components/QuestionFigure";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { readBrief } from "@/lib/figures/figureBrief";
import { checkFigure, checkReply } from "@/lib/figures/figureCheck";
import { drawWithCode } from "@/lib/figures/figureDraw";
import { FIGURE_EXAMPLES, type FigureRequest } from "@/lib/figures/figurePrompt";

// DEV ONLY — figures code draws, the figure prompt's worked examples and the
// DeepSeek trial's results (scripts/figure-trial.ts), each on a question card
// with the checker's verdict.
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
        <h2>Drawn by code</h2>
        {CODE_DRAWN_SAMPLES.map((r) => (
          <CodeCard key={r.question} request={r} />
        ))}
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

/** Questions whose figures code draws, as the writer would brief them. */
const CODE_DRAWN_SAMPLES: FigureRequest[] = [
  {
    subject: "chemistry",
    question:
      "Police find a note written in black ink. Paper chromatography is used to compare the ink on the note with the black inks from three pens, P, Q and R. All four samples were run in the same solvent.\n\nThe chromatogram shows the results.\n\n(a) State which pen could have been used to write the note and give the evidence from the chromatogram.",
    brief: {
      kind: "chromatogram",
      y: { title: "distance moved in cm", min: 0, max: 10, step: 1 },
      front: 10,
      samples: [
        { name: "note", spots: [2.4, 5.2] },
        { name: "P", spots: [2.4, 5.2, 7.9] },
        { name: "Q", spots: [2.4, 5.2] },
        { name: "R", spots: [3, 6.1] },
      ],
    },
  },
  {
    subject: "chemistry",
    question:
      "A student tests three food colourings, A, B and C, and two known dyes, E102 and E133. Which food colouring contains a substance that is insoluble in the solvent?",
    options: ["A", "B", "C", "None of them"],
    brief: {
      kind: "chromatogram",
      y: { title: "distance in cm", min: 0, max: 8, step: 1 },
      front: 7,
      samples: [
        { name: "A", spots: [1.5, 4] },
        { name: "B", spots: [0, 3] },
        { name: "C", spots: [4, 5.5] },
        { name: "E102", spots: [4] },
        { name: "E133", spots: [1.5] },
      ],
    },
  },
  {
    subject: "physics",
    question: "The diagram shows a transverse wave. Which arrow shows the amplitude of the wave?",
    options: ["A", "B", "C", "D"],
    brief: {
      kind: "wave",
      arrows: [
        { shows: "crest to trough", letter: "A" },
        { shows: "amplitude", letter: "B" },
        { shows: "wavelength", letter: "C" },
        { shows: "half a wavelength", letter: "D" },
      ],
    },
  },
  {
    subject: "physics",
    question:
      "The graph shows a wave on a rope at one instant. What are the amplitude and the wavelength of the wave?",
    options: [
      "amplitude 3 cm, wavelength 20 cm",
      "amplitude 6 cm, wavelength 20 cm",
      "amplitude 3 cm, wavelength 10 cm",
      "amplitude 6 cm, wavelength 40 cm",
    ],
    brief: {
      kind: "wave",
      x: { title: "distance in cm", min: 0, max: 40, step: 5 },
      y: { title: "displacement in cm", min: -4, max: 4, step: 1 },
      amplitude: 3,
      wavelength: 20,
    },
  },
  {
    subject: "physics",
    question:
      "The oscilloscope trace shows a sound wave. Calculate the frequency of the sound wave.",
    brief: {
      kind: "wave",
      x: { title: "time in ms", min: 0, max: 10, step: 1 },
      y: { title: "potential difference in V", min: -3, max: 3, step: 1 },
      amplitude: 2,
      wavelength: 4,
    },
  },
  {
    subject: "physics",
    question:
      "The diagram shows the forces acting on a van. The resultant force on the van is 1500 N to the right. Calculate force X.",
    brief: {
      kind: "forces",
      object: "van",
      toScale: false,
      forces: [
        { direction: "right", name: "driving force", size: 2500 },
        { direction: "left", name: "X", size: null },
        { direction: "up", name: "normal contact force", size: 18000 },
        { direction: "down", name: "weight", size: 18000 },
      ],
    },
  },
  {
    subject: "physics",
    question:
      "The diagram shows the forces on a falling skydiver. Which describes the motion of the skydiver?",
    options: ["speeding up", "slowing down", "falling at a steady speed", "not moving"],
    brief: {
      kind: "forces",
      object: "skydiver",
      toScale: true,
      forces: [
        { direction: "up", name: "air resistance", size: 400 },
        { direction: "down", name: "weight", size: 700 },
      ],
    },
  },
];

/** A question with the figure code draws for it, or why it wasn't drawn. */
function CodeCard({ request }: { request: FigureRequest }) {
  const read = readBrief(request.brief);
  const drawn = "brief" in read ? drawWithCode(read.brief) : null;
  const problems =
    "problem" in read
      ? [`The brief ${read.problem}`]
      : !drawn
        ? ["The brief doesn't fit its canvas"]
        : checkFigure(drawn.svg, read.brief).problems;
  return (
    <section
      className={`premium-card space-y-4 p-4 sm:p-5 ${SUBJECT_TINT[request.subject] ?? "tint-primary"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip chip-solid">{request.brief.kind}</span>
        <span className="chip">{problems.length ? "rejected" : "passes the checker"}</span>
      </div>
      <SciBlock text={request.question} className="font-display text-lg break-words" />
      {drawn && "brief" in read ? (
        <QuestionFigure svg={drawn.svg} alt={drawn.alt} brief={read.brief} />
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
      {problems.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}
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
