import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, RotateCcw, X } from "lucide-react";
import { evaluate, parseFormula } from "@/lib/notes/formula";
import {
  fillTemplate,
  inlineRuns,
  stepsOf,
  type ExplorerDiagram,
  type PracticeDiagram,
  type PunnettDiagram,
  type SequenceDiagram,
  type SortDiagram,
} from "@/lib/notes/noteFormat";

/**
 * The self-test interactives a note can carry. Each is a template filled with
 * data from the note, so they behave the same in every note.
 *
 * Anything shuffled or random starts from a seed taken from the note's own
 * text, so the server and the browser render the same first frame; only a
 * student's "Reset" or "New question" draws fresh randomness.
 */

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineRuns(text).map((r, i) =>
        r.bold ? <b key={i}>{r.text}</b> : <span key={i}>{r.text}</span>,
      )}
    </>
  );
}

function seeded(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Frame({ alt, title, children }: { alt: string; title: string; children: ReactNode }) {
  return (
    <figure
      aria-label={alt}
      className="space-y-4 rounded-2xl border-[1.5px] border-[color-mix(in_oklab,var(--tint)_30%,transparent)] p-4 sm:p-5"
    >
      <p className="font-display text-base font-extrabold">{title}</p>
      {children}
    </figure>
  );
}

const btn = "btn-premium inline-flex items-center gap-2 px-3 py-1.5 text-sm";
const iconBtn =
  "inline-flex size-8 items-center justify-center rounded-lg border border-border bg-card disabled:opacity-30";

function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p
      className={`${ok ? "tint-emerald" : "tint-rose"} flex items-center gap-2 font-bold text-[color-mix(in_oklab,var(--tint)_80%,var(--foreground))]`}
      role="status"
    >
      {ok ? <Check className="size-5" aria-hidden /> : <X className="size-5" aria-hidden />}
      {children}
    </p>
  );
}

// ── Order it ────────────────────────────────────────────────────────────────

export function Sequence({ d }: { d: SequenceDiagram }) {
  const start = (rand: () => number) => {
    const idx = d.steps.map((_, i) => i);
    // A real jumble: at most a third of the steps start in their right place.
    const inPlace = (s: number[]) => s.filter((v, i) => v === i).length;
    let s = shuffled(idx, rand);
    for (let tries = 0; tries < 50 && inPlace(s) > Math.floor(idx.length / 3); tries++)
      s = shuffled(idx, rand);
    return s;
  };
  const [order, setOrder] = useState(() => start(seeded(d.steps.join("|"))));
  const [checked, setChecked] = useState(false);
  const right = order.filter((v, i) => v === i).length;
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setChecked(false);
  };

  return (
    <Frame alt={d.alt} title={d.prompt}>
      <ol className="space-y-2">
        {order.map((step, i) => (
          <li
            key={step}
            className={`flex items-center gap-3 rounded-xl border-[1.5px] p-2.5 ${
              checked ? (step === i ? "tint-emerald" : "tint-rose") : ""
            } border-[color-mix(in_oklab,var(--tint)_35%,transparent)] bg-[color-mix(in_oklab,var(--tint)_6%,var(--card))]`}
          >
            <span className="numeral w-6 shrink-0 text-center">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <Inline text={d.steps[step]} />
            </span>
            <span className="flex shrink-0 gap-1">
              <button
                className={iconBtn}
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move "${d.steps[step]}" up`}
              >
                <ArrowUp className="size-4" />
              </button>
              <button
                className={iconBtn}
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1}
                aria-label={`Move "${d.steps[step]}" down`}
              >
                <ArrowDown className="size-4" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {checked ? (
        <Verdict ok={right === order.length}>
          {right === order.length
            ? "All in the right order."
            : `${right} of ${order.length} in the right place. Keep going.`}
        </Verdict>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={() => setChecked(true)}>
          <Check className="size-4" aria-hidden /> Check order
        </button>
        <button
          className={btn}
          onClick={() => {
            setOrder(d.steps.map((_, i) => i));
            setChecked(true);
          }}
        >
          Show answer
        </button>
        <button
          className={btn}
          onClick={() => {
            setOrder(start(Math.random));
            setChecked(false);
          }}
        >
          <RotateCcw className="size-4" aria-hidden /> Reset
        </button>
      </div>
    </Frame>
  );
}

// ── Sort it ─────────────────────────────────────────────────────────────────

export function Sort({ d }: { d: SortDiagram }) {
  const [items, setItems] = useState(() =>
    shuffled(d.items, seeded(d.items.map((i) => i.text).join("|"))),
  );
  const [placed, setPlaced] = useState<(number | null)[]>(() => d.items.map(() => null));
  const [checked, setChecked] = useState(false);
  const right = items.filter((it, i) => placed[i] === it.group).length;

  return (
    <Frame alt={d.alt} title={d.prompt}>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li
            key={it.text}
            className={`rounded-xl border-[1.5px] p-3 ${checked && placed[i] != null ? (placed[i] === it.group ? "tint-emerald" : "tint-rose") : ""} border-[color-mix(in_oklab,var(--tint)_35%,transparent)] bg-[color-mix(in_oklab,var(--tint)_6%,var(--card))]`}
          >
            <p>
              <Inline text={it.text} />
            </p>
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="radiogroup"
              aria-label={`Group for: ${it.text}`}
            >
              {d.groups.map((g, gi) => (
                <button
                  key={g}
                  role="radio"
                  aria-checked={placed[i] === gi}
                  onClick={() => {
                    const p = [...placed];
                    p[i] = gi;
                    setPlaced(p);
                    setChecked(false);
                  }}
                  className={`chip ${placed[i] === gi ? "chip-solid" : ""}`}
                >
                  {g}
                </button>
              ))}
            </div>
            {checked && placed[i] != null && placed[i] !== it.group ? (
              <p className="mt-2 text-sm font-bold">This one belongs in: {d.groups[it.group]}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {checked ? (
        <Verdict ok={right === items.length}>
          {right === items.length
            ? "All sorted correctly."
            : `${right} of ${items.length} correct.`}
        </Verdict>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          className={btn}
          onClick={() => setChecked(true)}
          disabled={placed.every((p) => p == null)}
        >
          <Check className="size-4" aria-hidden /> Check
        </button>
        <button
          className={btn}
          onClick={() => {
            setItems(shuffled(d.items, Math.random));
            setPlaced(d.items.map(() => null));
            setChecked(false);
          }}
        >
          <RotateCcw className="size-4" aria-hidden /> Reset
        </button>
      </div>
    </Frame>
  );
}

// ── Punnett square ──────────────────────────────────────────────────────────

export function Punnett({ d }: { d: PunnettDiagram }) {
  const D = d.alleles.dominant;
  const [p1, setP1] = useState(d.parent_options[0][0]);
  const [p2, setP2] = useState(d.parent_options[1][0]);
  const norm = (a: string, b: string) =>
    [a, b].sort((x, y) => (x === D ? -1 : y === D ? 1 : 0)).join("");
  const pheno = (g: string) => (g.includes(D) ? d.phenotypes.dominant : d.phenotypes.recessive);
  const cells = [...p2].map((r) => [...p1].map((c) => norm(c, r)));
  const flat = cells.flat();
  const count = (f: (g: string) => boolean) => flat.filter(f).length;
  const genotypes = [...new Set(flat)].sort(
    (a, b) => count((g) => g === b) - count((g) => g === a),
  );
  const labels = d.parent_labels ?? ["Parent 1", "Parent 2"];

  const picker = (label: string, opts: string[], value: string, set: (g: string) => void) => (
    <div>
      <p className="font-bold">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {opts.map((g) => (
          <button
            key={g}
            role="radio"
            aria-checked={g === value}
            onClick={() => set(g)}
            className={`chip ${g === value ? "chip-solid" : ""}`}
          >
            {g} <span className="font-normal">({pheno(g)})</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Frame alt={d.alt} title="Make a cross">
      <div className="grid gap-4 sm:grid-cols-2">
        {picker(labels[0], d.parent_options[0], p1, setP1)}
        {picker(labels[1], d.parent_options[1], p2, setP2)}
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <table className="border-collapse text-center text-lg" aria-label="Punnett square">
          <thead>
            <tr>
              <th className="size-12" />
              {[...p1].map((a, i) => (
                <th key={i} className="font-display size-12 font-extrabold">
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((row, ri) => (
              <tr key={ri}>
                <th className="font-display size-12 font-extrabold">{p2[ri]}</th>
                {row.map((g, ci) => (
                  <td
                    key={ci}
                    className={`${g.includes(D) ? "tint-primary" : "tint-amber"} size-14 border-[1.5px] border-border bg-[color-mix(in_oklab,var(--tint)_14%,var(--card))] font-bold`}
                  >
                    {g}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="min-w-0 space-y-2" aria-live="polite">
          <div>
            <dt className="font-bold">Genotypes</dt>
            <dd>{genotypes.map((g) => `${g}: ${count((x) => x === g)} in 4`).join(" · ")}</dd>
          </div>
          {[d.phenotypes.dominant, d.phenotypes.recessive].map((ph) => {
            const n = count((g) => pheno(g) === ph);
            return (
              <div key={ph}>
                <dt className="font-bold">{ph}</dt>
                <dd>
                  {n} in 4 · probability {String(n / 4)} · {n * 25}%
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </Frame>
  );
}

// ── Calculation practice ────────────────────────────────────────────────────

const show = (n: number, dp = 4) => (Number.isFinite(n) ? String(+n.toFixed(dp)) : "–");

export function Practice({ d }: { d: PracticeDiagram }) {
  const tree = useMemo(() => parseFormula(d.answer.formula), [d.answer.formula]);
  const draw = (rand: () => number) =>
    Object.fromEntries(
      d.variables.map((v) => {
        const opts = stepsOf(v);
        return [v.id, opts[Math.floor(rand() * opts.length)]];
      }),
    );
  const [vars, setVars] = useState(() => draw(seeded(d.question)));
  const [guess, setGuess] = useState("");
  const [verdict, setVerdict] = useState<null | boolean>(null);
  const [working, setWorking] = useState(false);

  const answer = evaluate(tree, vars);
  const rounded = +answer.toFixed(d.answer.decimals);
  const values = {
    ...Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, show(v)])),
    answer: `${show(rounded, d.answer.decimals)}${d.answer.unit ? ` ${d.answer.unit}` : ""}`,
  };
  const check = () => {
    const g = Number(guess.replace(/,/g, "").trim());
    if (!guess.trim() || !Number.isFinite(g)) return setVerdict(false);
    const tol =
      d.answer.tolerance_percent != null
        ? Math.abs(answer) * (d.answer.tolerance_percent / 100)
        : 0.5 * 10 ** -d.answer.decimals;
    setVerdict(Math.abs(g - answer) <= tol + 1e-12);
  };
  const next = () => {
    setVars(draw(Math.random));
    setGuess("");
    setVerdict(null);
    setWorking(false);
  };

  return (
    <Frame alt={d.alt} title="Practise the calculation">
      <p>
        <Inline text={fillTemplate(d.question, values)} />
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <label htmlFor={`practice-${d.question.length}`} className="sr-only">
          Your answer
        </label>
        <input
          id={`practice-${d.question.length}`}
          inputMode="decimal"
          value={guess}
          onChange={(e) => {
            setGuess(e.target.value);
            setVerdict(null);
          }}
          placeholder="Your answer"
          className="w-36 rounded-lg border-[1.5px] border-border bg-card px-3 py-1.5 text-base font-bold"
        />
        {d.answer.unit ? <span className="font-bold">{d.answer.unit}</span> : null}
        <button type="submit" className={btn}>
          <Check className="size-4" aria-hidden /> Check
        </button>
      </form>
      {verdict != null ? (
        <Verdict ok={verdict}>
          {verdict
            ? `Correct: ${values.answer}`
            : `Not quite. Give your answer to ${d.answer.decimals} decimal place${d.answer.decimals === 1 ? "" : "s"}, or look at the working.`}
        </Verdict>
      ) : null}
      {working ? (
        <ol className="list-decimal space-y-1 pl-6">
          {d.working.map((w, i) => (
            <li key={i}>
              <Inline text={fillTemplate(w, values)} />
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={() => setWorking(!working)} aria-expanded={working}>
          {working ? "Hide working" : "Show working"}
        </button>
        <button className={btn} onClick={next}>
          <RotateCcw className="size-4" aria-hidden /> New question
        </button>
      </div>
    </Frame>
  );
}

// ── Parts explorer ──────────────────────────────────────────────────────────

export function Explorer({ d }: { d: ExplorerDiagram }) {
  const [mode, setMode] = useState<"learn" | "test">("learn");
  const [sel, setSel] = useState(0);
  const order = (rand: () => number) =>
    shuffled(
      d.parts.map((_, i) => i),
      rand,
    );
  const [queue, setQueue] = useState(() => order(seeded(d.prompt)));
  const [q, setQ] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const target = queue[q];
  const choices = useMemo(() => {
    const rand = seeded(`${d.prompt}${q}${queue.join()}`);
    const others = shuffled(
      d.parts.map((_, i) => i).filter((i) => i !== target),
      rand,
    ).slice(0, 3);
    return shuffled([target, ...others], rand);
  }, [d.parts, d.prompt, q, queue, target]);
  const restart = () => {
    setQueue(order(Math.random));
    setQ(0);
    setPicked(null);
    setScore(0);
  };

  return (
    <Frame alt={d.alt} title={d.prompt}>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Mode">
        <button
          role="tab"
          aria-selected={mode === "learn"}
          onClick={() => setMode("learn")}
          className={`chip ${mode === "learn" ? "chip-solid" : ""}`}
        >
          Learn
        </button>
        <button
          role="tab"
          aria-selected={mode === "test"}
          onClick={() => {
            setMode("test");
            restart();
          }}
          className={`chip ${mode === "test" ? "chip-solid" : ""}`}
        >
          Test yourself
        </button>
      </div>
      {mode === "learn" ? (
        <>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Parts">
            {d.parts.map((p, i) => (
              <button
                key={p.name}
                role="radio"
                aria-checked={i === sel}
                onClick={() => setSel(i)}
                className={`chip ${i === sel ? "chip-solid" : ""}`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div
            className="rounded-xl bg-[color-mix(in_oklab,var(--tint)_7%,var(--card))] p-4"
            aria-live="polite"
          >
            <p className="font-display text-lg font-extrabold">{d.parts[sel].name}</p>
            <p className="mt-1">
              <Inline text={d.parts[sel].detail} />
            </p>
          </div>
        </>
      ) : q < queue.length ? (
        <>
          <p className="font-bold">
            Question {q + 1} of {queue.length} · score {score}
          </p>
          <div className="rounded-xl bg-[color-mix(in_oklab,var(--tint)_7%,var(--card))] p-4">
            <Inline text={d.parts[target].detail} />
          </div>
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => (
              <button
                key={c}
                disabled={picked != null}
                onClick={() => {
                  setPicked(c);
                  if (c === target) setScore(score + 1);
                }}
                className={`chip ${picked != null && c === target ? "tint-emerald chip-solid" : picked === c ? "tint-rose chip-solid" : ""}`}
              >
                {d.parts[c].name}
              </button>
            ))}
          </div>
          {picked != null ? (
            <div className="flex flex-wrap items-center gap-3">
              <Verdict ok={picked === target}>
                {picked === target ? "Correct." : `It's the ${d.parts[target].name}.`}
              </Verdict>
              <button
                className={btn}
                onClick={() => {
                  setQ(q + 1);
                  setPicked(null);
                }}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="space-y-3">
          <Verdict ok={score === queue.length}>
            You scored {score} out of {queue.length}.
          </Verdict>
          <button className={btn} onClick={restart}>
            <RotateCcw className="size-4" aria-hidden /> Try again
          </button>
        </div>
      )}
    </Frame>
  );
}
