import { useMemo, useState, type ReactNode } from "react";
import { evaluate, parseFormula } from "@/lib/notes/formula";
import { Explorer, Practice, Punnett, Sequence, Sort } from "@/components/notes/NoteInteractives";
import { ParticlesScene, RoadScene, WaveScene } from "@/components/notes/NoteScenes";
import {
  CircuitView,
  DiffusionView,
  EnzymeView,
  GasSyringeView,
  HalfLifeView,
  PhScaleView,
  PredictorSceneView,
} from "@/components/notes/SceneLibrary";
import { BookOpen, Eye, EyeOff, ArrowRight, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/Shared";
import { SUBJECT_LABEL, SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import {
  inlineRuns,
  type CompareDiagram,
  type FlowDiagram,
  type LineGraphDiagram,
  type Note,
  type NoteBlock,
  type NoteBoard,
  type NoteDiagram,
  type PredictorDiagram,
  type SliderDiagram,
} from "@/lib/notes/noteFormat";

const BOARD_LABEL: Record<NoteBoard, string> = { aqa: "AQA", edexcel: "Edexcel", ocr: "OCR" };

/** Text with **bold** runs. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineRuns(text).map((r, i) =>
        r.bold ? <b key={i}>{r.text}</b> : <span key={i}>{r.text}</span>,
      )}
    </>
  );
}

export function Reveal({ q, a, marks }: { q: string; a: ReactNode; marks?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="premium-card planner-point-row p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-bold">
          <Inline text={q} />
        </p>
        {marks ? (
          <span className="chip shrink-0">
            {marks} {marks === 1 ? "mark" : "marks"}
          </span>
        ) : null}
      </div>
      {open ? <div className="mt-3">{a}</div> : null}
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="btn-premium mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm"
      >
        {open ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        {open ? "Hide answer" : "Show answer"}
      </button>
    </div>
  );
}

// ── Diagrams ────────────────────────────────────────────────────────────────

const SERIES_TINTS = ["tint-primary", "tint-rose", "tint-amber", "tint-chem", "tint-emerald"];

function LineGraph({ d }: { d: LineGraphDiagram }) {
  const [active, setActive] = useState<string | null>(null);
  const X0 = 44,
    X1 = 600,
    TOP = 30,
    Y0 = 200,
    H = Y0 - TOP;
  const sx = (x: number) => X0 + ((x - d.x.min) / (d.x.max - d.x.min)) * (X1 - X0);
  const sy = (y: number) => Y0 - y * H;
  // A monotone curve (Steffen): it never overshoots its points, so a flat run
  // stays flat (a heating curve's plateau) and a peak stays where it was put.
  const curve = (pts: [number, number][]) => {
    const p = pts.map(([x, y]) => [sx(x), sy(y)]);
    const n = p.length;
    const secant = (i: number) => {
      const h = p[i + 1][0] - p[i][0];
      return h ? (p[i + 1][1] - p[i][1]) / h : 0;
    };
    const t = p.map((_, i) => {
      if (i === 0 || i === n - 1) return 0;
      const h0 = p[i][0] - p[i - 1][0],
        h1 = p[i + 1][0] - p[i][0],
        s0 = secant(i - 1),
        s1 = secant(i),
        mean = h0 + h1 ? (s0 * h1 + s1 * h0) / (h0 + h1) : 0;
      return (
        (Math.sign(s0) + Math.sign(s1)) *
          Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(mean)) || 0
      );
    });
    if (n === 2) t[0] = t[1] = secant(0);
    else if (n > 2) {
      t[0] = (3 * secant(0) - t[1]) / 2;
      t[n - 1] = (3 * secant(n - 2) - t[n - 2]) / 2;
    }
    let s = `M ${p[0][0]} ${p[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
      const dx = (p[i + 1][0] - p[i][0]) / 3;
      s += ` C ${p[i][0] + dx} ${p[i][1] + dx * t[i]}, ${p[i + 1][0] - dx} ${p[i + 1][1] - dx * t[i + 1]}, ${p[i + 1][0]} ${p[i + 1][1]}`;
    }
    return s;
  };
  // Label each line at its highest point, nudged down if it would sit on another label.
  const placed: { x: number; y: number }[] = [];
  const labels = d.series.map((s) => {
    const [px, py] = s.points.reduce((m, p) => (p[1] > m[1] ? p : m));
    const x = Math.min(Math.max(sx(px), X0 + 30), X1 - 40);
    let y = sy(py) - 8;
    while (placed.some((q) => Math.abs(q.x - x) < 80 && Math.abs(q.y - y) < 16)) y += 16;
    placed.push({ x, y });
    return { x, y };
  });
  const bandsY = Y0 + 44;
  const height = d.bands?.length ? bandsY + 14 : Y0 + 30;

  return (
    <figure className="space-y-3">
      <div className="-mx-1 overflow-x-auto px-1">
        <svg
          viewBox={`0 0 640 ${height}`}
          className="w-full min-w-[520px]"
          role="img"
          aria-label={d.alt}
        >
          <line
            x1={X0}
            y1={Y0}
            x2={X1}
            y2={Y0}
            stroke="var(--foreground)"
            strokeOpacity=".3"
            strokeWidth="1.5"
          />
          <line
            x1={X0}
            y1={TOP - 10}
            x2={X0}
            y2={Y0}
            stroke="var(--foreground)"
            strokeOpacity=".3"
            strokeWidth="1.5"
          />
          <text
            x={14}
            y={(TOP + Y0) / 2}
            transform={`rotate(-90 14 ${(TOP + Y0) / 2})`}
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill="var(--foreground)"
          >
            {d.y.label}
          </text>
          {d.y.zero != null ? (
            <g>
              <line
                x1={X0}
                y1={sy(d.y.zero)}
                x2={X1}
                y2={sy(d.y.zero)}
                stroke="var(--foreground)"
                strokeOpacity=".45"
                strokeDasharray="6 4"
              />
              <text
                x={X1}
                y={sy(d.y.zero) - 6}
                textAnchor="end"
                fontSize="12"
                fontWeight="800"
                fill="var(--foreground)"
              >
                0
              </text>
            </g>
          ) : null}
          {d.markers?.map((m) => (
            <g key={m.label}>
              <line
                x1={sx(m.x)}
                y1={TOP - 6}
                x2={sx(m.x)}
                y2={Y0}
                stroke="var(--foreground)"
                strokeOpacity=".3"
                strokeDasharray="4 4"
              />
              <text
                x={sx(m.x)}
                y={TOP - 12}
                textAnchor="middle"
                fontSize="12"
                fontWeight="800"
                fill="var(--foreground)"
              >
                {m.label}
              </text>
            </g>
          ))}
          {d.series.map((s, i) => (
            <g
              key={s.name}
              className={SERIES_TINTS[i]}
              opacity={active && active !== s.name ? 0.15 : 1}
              style={{ transition: "opacity .2s" }}
            >
              <path
                d={curve(s.points)}
                fill="none"
                stroke="var(--tint)"
                strokeWidth={active === s.name ? 4 : 3}
                strokeLinecap="round"
              />
              {d.series.length > 1 ? (
                <text
                  x={labels[i].x}
                  y={labels[i].y}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="800"
                  fill="var(--tint)"
                >
                  {s.name}
                </text>
              ) : null}
            </g>
          ))}
          {d.x.ticks.map((t) => (
            <text
              key={t}
              x={sx(t)}
              y={Y0 + 18}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="var(--foreground)"
            >
              {t}
            </text>
          ))}
          {!d.bands?.length
            ? null
            : d.bands.map((b) => (
                <text
                  key={b.label}
                  x={(sx(b.from) + sx(b.to)) / 2}
                  y={bandsY}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="800"
                  fill="var(--foreground)"
                  opacity=".75"
                >
                  {b.label}
                </text>
              ))}
        </svg>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-bold">
        <span>
          {d.x.label}
          {d.x.unit && !d.x.label.includes(d.x.unit) ? ` (${d.x.unit})` : ""}
        </span>
        {d.series.length > 1
          ? d.series.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setActive(active === s.name ? null : s.name)}
                aria-pressed={active === s.name}
                className={`${SERIES_TINTS[i]} inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-[color-mix(in_oklab,var(--tint)_12%,transparent)] ${active === s.name ? "bg-[color-mix(in_oklab,var(--tint)_16%,transparent)]" : ""}`}
              >
                <span className="h-1 w-4 rounded-full bg-[var(--tint)]" aria-hidden />
                {s.name}
              </button>
            ))
          : null}
      </figcaption>
    </figure>
  );
}

function Flow({ d }: { d: FlowDiagram }) {
  return (
    <figure aria-label={d.alt} className="space-y-2">
      <ol className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {d.steps.map((s, i) => (
          <li key={i} className="flex flex-col items-center gap-2 sm:flex-row">
            <span className="rounded-xl border-[1.5px] border-[color-mix(in_oklab,var(--tint)_40%,transparent)] bg-[color-mix(in_oklab,var(--tint)_8%,var(--card))] px-3 py-2 text-center text-base font-bold">
              <Inline text={s} />
            </span>
            {i < d.steps.length - 1 ? (
              <ArrowRight
                className="size-5 shrink-0 rotate-90 text-[var(--tint)] sm:rotate-0"
                aria-hidden
              />
            ) : null}
          </li>
        ))}
      </ol>
      {d.loop ? (
        <p className="flex items-center gap-2 text-sm font-bold">
          <RotateCcw className="size-4 text-[var(--tint)]" aria-hidden /> Then back to the start:
          the cycle repeats.
        </p>
      ) : null}
    </figure>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <>
      <table className="hidden w-full border-collapse text-left text-base sm:table">
        <thead>
          <tr className="border-b-2 border-[color-mix(in_oklab,var(--tint)_40%,transparent)]">
            {columns.map((c) => (
              <th key={c} className="font-display py-2 pr-4 font-extrabold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:py-3 [&_td]:pr-4 [&_td]:align-top [&_tr]:border-b [&_tr]:border-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={j === 0 ? "font-bold" : undefined}>
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* On a phone a table becomes stacked blocks, so nothing scrolls sideways. */}
      <div className="divide-y divide-border sm:hidden">
        {rows.map((r, i) => (
          <div key={i} className="py-3">
            <p className="font-display text-lg font-extrabold">
              <Inline text={r[0]} />
            </p>
            {r.slice(1).map((cell, j) => (
              <p key={j}>
                <b>{columns[j + 1]}:</b> <Inline text={cell} />
              </p>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function Compare({ d }: { d: CompareDiagram }) {
  return <Table columns={["", ...d.items]} rows={d.rows.map((r) => [r.feature, ...r.values])} />;
}

function Predictor({ d }: { d: PredictorDiagram }) {
  const [i, setI] = useState(0);
  const o = d.options[i];
  return (
    <figure
      aria-label={d.alt}
      className="rounded-2xl border-[1.5px] border-[color-mix(in_oklab,var(--tint)_30%,transparent)] p-4 sm:p-5"
    >
      <p className="font-display text-base font-extrabold">{d.prompt}</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={d.prompt}>
        {d.options.map((opt, n) => (
          <button
            key={opt.label}
            role="radio"
            aria-checked={n === i}
            onClick={() => setI(n)}
            className={`chip ${n === i ? "chip-solid" : ""}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {/* The reaction profile drawing is withheld until it is redrawn: it put
          activation energy on the slope instead of from reactants to the peak. */}
      {o.scene && o.scene.kind !== "energy-profile" ? (
        <div className="mt-4">
          <PredictorSceneView s={o.scene} />
        </div>
      ) : null}
      <dl
        className="mt-4 divide-y divide-border rounded-xl bg-[color-mix(in_oklab,var(--tint)_7%,var(--card))] px-4"
        aria-live="polite"
      >
        {d.result_labels.map((label, n) => (
          <div key={label} className="py-3 sm:flex sm:gap-4">
            <dt className="shrink-0 font-bold sm:w-44">{label}</dt>
            <dd>
              <Inline text={o.results[n]} />
            </dd>
          </div>
        ))}
      </dl>
      {o.explanation ? (
        <p className="mt-3">
          <Inline text={o.explanation} />
        </p>
      ) : null}
    </figure>
  );
}

function fmt(n: number, decimals = 1) {
  return Number.isFinite(n)
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
      })
    : "–";
}

/** An input's value as 0–1 across its own range (a choice counts by position). */
function share(d: SliderDiagram, id: string, vals: Record<string, number>) {
  const inp = d.inputs.find((i) => i.id === id);
  if (!inp) return 0.5;
  if ("choices" in inp) {
    const k = inp.choices.findIndex((c) => c.value === vals[id]);
    return inp.choices.length > 1 ? Math.max(0, k) / (inp.choices.length - 1) : 0.5;
  }
  return (vals[id] - inp.min) / (inp.max - inp.min);
}

/** The largest value an input can take (a slider's max, or its biggest choice). */
function topOf(d: SliderDiagram, id: string) {
  const inp = d.inputs.find((i) => i.id === id);
  if (!inp) return 1;
  return "choices" in inp ? Math.max(...inp.choices.map((c) => c.value)) : inp.max;
}

function SliderSceneView({
  d,
  vals,
  results,
}: {
  d: SliderDiagram;
  vals: Record<string, number>;
  results: number[];
}) {
  const s = d.scene!;
  switch (s.kind) {
    case "road":
      return <RoadScene thinking={results[s.thinking]} braking={results[s.braking]} />;
    case "wave":
      return (
        <WaveScene
          amplitude={share(d, s.amplitude, vals)}
          frequency={share(d, s.frequency, vals)}
        />
      );
    case "particles": {
      const t = d.inputs.find((i) => i.id === s.temperature);
      return (
        <ParticlesScene
          temperature={vals[s.temperature]}
          melting={s.melting}
          boiling={s.boiling}
          unit={t && !("choices" in t) ? t.unit : undefined}
        />
      );
    }
    case "half-life":
      return <HalfLifeView time={vals[s.time]} halfLife={s.half_life} />;
    case "gas-syringe":
      return (
        <GasSyringeView
          volume={results[s.volume]}
          max={s.max}
          rate={s.rate != null ? results[s.rate] : undefined}
        />
      );
    case "circuit":
      return (
        <CircuitView arrangement={s.arrangement} brightness={results[s.brightness]} max={s.max} />
      );
    case "enzyme":
      return (
        <EnzymeView value={vals[s.condition]} optimum={s.optimum} denaturesAt={s.denatures_at} />
      );
    case "diffusion":
      return (
        <DiffusionView
          left={vals[s.left]}
          right={vals[s.right]}
          top={Math.max(topOf(d, s.left), topOf(d, s.right))}
          membrane={s.membrane}
        />
      );
    case "ph":
      return <PhScaleView ph={vals[s.ph]} />;
  }
}

function Slider({ d }: { d: SliderDiagram }) {
  const [vals, setVals] = useState<Record<string, number>>(() =>
    Object.fromEntries(d.inputs.map((i) => [i.id, "choices" in i ? i.choices[0].value : i.value])),
  );
  const trees = useMemo(() => d.outputs.map((o) => parseFormula(o.formula)), [d.outputs]);
  const results = trees.map((t) => {
    try {
      return evaluate(t, vals);
    } catch {
      return NaN;
    }
  });
  const barIdx = d.outputs.map((o, n) => (o.bar ? n : -1)).filter((n) => n >= 0);
  // Scale the bar to its largest possible size, so it visibly grows and shrinks.
  const maxVals = Object.fromEntries(
    d.inputs.map((i) => [
      i.id,
      "choices" in i ? Math.max(...i.choices.map((c) => c.value)) : i.max,
    ]),
  );
  const barTotal = (v: Record<string, number>) =>
    barIdx.reduce((s, n) => s + Math.max(0, evaluate(trees[n], v)), 0);
  let scale = 1;
  try {
    scale = Math.max(barTotal(maxVals), barTotal(vals), 1e-9);
  } catch {
    /* bar hidden below */
  }

  return (
    <figure
      aria-label={d.alt}
      className="space-y-4 rounded-2xl border-[1.5px] border-[color-mix(in_oklab,var(--tint)_30%,transparent)] p-4 sm:p-5"
    >
      {d.inputs.map((inp) =>
        "choices" in inp ? (
          <div key={inp.id}>
            <p className="font-bold">{inp.label}</p>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={inp.label}>
              {inp.choices.map((c) => (
                <button
                  key={c.label}
                  role="radio"
                  aria-checked={vals[inp.id] === c.value}
                  onClick={() => setVals((v) => ({ ...v, [inp.id]: c.value }))}
                  className={`chip ${vals[inp.id] === c.value ? "chip-solid" : ""}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div key={inp.id}>
            <label
              htmlFor={`slider-${inp.id}`}
              className="flex flex-wrap items-baseline justify-between gap-2 font-bold"
            >
              <span>{inp.label}</span>
              <span className="numeral text-lg">
                {fmt(vals[inp.id], inp.step < 1 ? 1 : 0)}
                {inp.unit ? ` ${inp.unit}` : ""}
              </span>
            </label>
            <input
              id={`slider-${inp.id}`}
              type="range"
              min={inp.min}
              max={inp.max}
              step={inp.step}
              value={vals[inp.id]}
              onChange={(e) => {
                const n = Number(e.target.value);
                setVals((v) => ({ ...v, [inp.id]: n }));
              }}
              className="mt-2 w-full accent-[var(--tint)]"
            />
          </div>
        ),
      )}
      {d.scene ? <SliderSceneView d={d} vals={vals} results={results} /> : null}
      {barIdx.length && d.scene?.kind !== "road" ? (
        <div
          className="flex h-6 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)]"
          aria-hidden
        >
          {barIdx.map((n, k) => (
            <span
              key={n}
              className={`${SERIES_TINTS[k]} block h-full bg-[var(--tint)] transition-[width] duration-300`}
              style={{ width: `${(Math.max(0, results[n]) / scale) * 100}%`, opacity: 0.85 }}
            />
          ))}
        </div>
      ) : null}
      <dl
        className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]"
        aria-live="polite"
      >
        {d.outputs.map((o, n) => (
          <div
            key={o.label}
            className={`${o.bar ? SERIES_TINTS[barIdx.indexOf(n)] : ""} rounded-xl bg-[color-mix(in_oklab,var(--tint)_9%,var(--card))] p-3`}
          >
            <dt className="font-bold">{o.label}</dt>
            <dd className="font-display text-2xl font-extrabold">
              <span className="numeral">{fmt(results[n], o.decimals ?? 1)}</span>
              {o.unit ? <span className="text-base"> {o.unit}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

function Diagram({ d }: { d: NoteDiagram }) {
  if (d.kind === "line-graph") return <LineGraph d={d} />;
  if (d.kind === "flow") return <Flow d={d} />;
  if (d.kind === "predictor") return <Predictor d={d} />;
  if (d.kind === "slider") return <Slider d={d} />;
  if (d.kind === "sequence") return <Sequence d={d} />;
  if (d.kind === "sort") return <Sort d={d} />;
  if (d.kind === "punnett") return <Punnett d={d} />;
  if (d.kind === "practice") return <Practice d={d} />;
  if (d.kind === "explorer") return <Explorer d={d} />;
  return <Compare d={d} />;
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function Block({ b }: { b: NoteBlock }) {
  switch (b.type) {
    case "paragraph":
      return (
        <p>
          <Inline text={b.text} />
        </p>
      );
    case "subheading":
      return <h3 className="font-display pt-2 text-lg font-extrabold">{b.text}</h3>;
    case "definitions":
      return (
        <div className="rounded-xl border-[1.5px] border-[color-mix(in_oklab,var(--tint)_30%,transparent)] p-4">
          <p className="font-display text-base font-extrabold">Key words</p>
          <dl className="mt-2 space-y-2">
            {b.items.map((d) => (
              <div key={d.term} className="sm:flex sm:gap-3">
                <dt className="shrink-0 font-bold text-[color-mix(in_oklab,var(--tint)_75%,var(--foreground))] sm:w-44">
                  {d.term}
                </dt>
                <dd>
                  <Inline text={d.meaning} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "equation":
      return (
        <div className="rounded-2xl bg-[color-mix(in_oklab,var(--tint)_11%,var(--card))] px-4 py-4 text-center sm:px-6">
          {b.label ? (
            <p className="font-display text-sm font-extrabold uppercase tracking-widest text-[color-mix(in_oklab,var(--tint)_75%,var(--foreground))]">
              {b.label}
            </p>
          ) : null}
          <p className="font-display mt-1 text-xl font-extrabold sm:text-2xl">{b.formula}</p>
          {b.where?.length ? (
            <ul className="mx-auto mt-3 max-w-md space-y-1 text-left text-base">
              {b.where.map((w, i) => (
                <li key={i}>
                  <Inline text={w} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    case "key-points":
      return (
        <div className="rounded-xl bg-[color-mix(in_oklab,var(--tint)_9%,var(--card))] p-4">
          <p className="font-display text-base font-extrabold">Key points</p>
          <ul className="mt-2 space-y-1.5">
            {b.items.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-[var(--tint)]"
                  aria-hidden
                />
                <span>
                  <Inline text={t} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "list":
      return (
        <ul className="list-disc space-y-2 pl-6">
          {b.items.map((t, i) => (
            <li key={i}>
              <Inline text={t} />
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="space-y-4">
          {b.items.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="numeral icon-tile size-8 shrink-0 text-sm">{i + 1}</span>
              <p>
                <b>{s.lead}</b> <Inline text={s.text} />
              </p>
            </li>
          ))}
        </ol>
      );
    case "table":
      return <Table columns={b.columns} rows={b.rows} />;
    case "diagram":
      return <Diagram d={b.diagram} />;
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section id={slug(heading)} className="mt-10 scroll-mt-6 space-y-4">
      <h2 className="font-display text-xl font-extrabold sm:text-2xl">{heading}</h2>
      {children}
    </section>
  );
}

// ── The note ────────────────────────────────────────────────────────────────

export function NoteView({ note, board }: { note: Note; board: NoteBoard }) {
  const layer = note.boards[board];
  const tint = SUBJECT_TINT[note.subject];
  const eyebrow = [
    `GCSE ${SUBJECT_LABEL[note.subject]}`,
    BOARD_LABEL[board],
    ...(layer?.spec_codes ?? []),
  ].join(" · ");

  return (
    <div className={`${tint} space-y-6`}>
      <PageHeader eyebrow={eyebrow} title={note.title} icon={BookOpen} />

      <article className="premium-card px-5 py-6 text-[1.0625rem] leading-relaxed sm:px-8 sm:py-8">
        <div className="max-w-[68ch]">
          <div className="rounded-xl bg-[color-mix(in_oklab,var(--tint)_9%,var(--card))] p-4 sm:p-5">
            <p className="font-display text-lg font-extrabold">The key idea</p>
            <p className="mt-1">
              <Inline text={note.key_idea} />
            </p>
          </div>

          <nav aria-label="In this note" className="mt-6">
            <p className="font-display text-base font-extrabold">In this note</p>
            <ol className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {[
                ...note.sections.map((s) => s.heading),
                ...(layer?.extra?.map((s) => s.heading) ?? []),
                ...(layer ? ["Exam tips"] : []),
                ...(layer?.worked_example ? ["Worked example"] : []),
                "Check your understanding",
              ].map((h, i) => (
                <li key={h} className="flex gap-2">
                  <span className="numeral w-5 shrink-0 text-[var(--tint)]">{i + 1}</span>
                  <a
                    href={`#${slug(h)}`}
                    className="font-bold underline decoration-[color-mix(in_oklab,var(--tint)_40%,transparent)] decoration-2 underline-offset-4 hover:decoration-[var(--tint)]"
                  >
                    {h}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {note.sections.map((s) => (
            <Section key={s.heading} heading={s.heading}>
              {s.blocks.map((b, i) => (
                <Block key={i} b={b} />
              ))}
            </Section>
          ))}

          {layer?.extra?.map((s) => (
            <Section key={s.heading} heading={s.heading}>
              {s.blocks.map((b, i) => (
                <Block key={i} b={b} />
              ))}
            </Section>
          ))}

          {layer ? (
            <Section heading="Exam tips">
              <p>These phrases come from {BOARD_LABEL[board]} mark schemes. Use them as written:</p>
              <ul className="list-disc space-y-2 pl-6">
                {layer.exam_phrases.map((p, i) => (
                  <li key={i}>
                    <Inline text={p} />
                  </li>
                ))}
              </ul>
              {layer.mistakes.length ? (
                <>
                  <p>Common ways students lose marks:</p>
                  <ul className="list-disc space-y-2 pl-6">
                    {layer.mistakes.map((m, i) => (
                      <li key={i}>
                        <Inline text={m.wrong} /> <Inline text={m.right} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Section>
          ) : null}

          {layer?.worked_example ? (
            <Section heading="Worked example">
              {/* `source` stays in the data for provenance; students see the question, not the paper. */}
              <p>A real exam question on this topic. Try it, then check the answer.</p>
              <Reveal
                q={layer.worked_example.question}
                marks={layer.worked_example.marks}
                a={
                  <ol className="list-decimal space-y-1.5 pl-6">
                    {layer.worked_example.answer_points.map((p, i) => (
                      <li key={i}>
                        <Inline text={p} />
                      </li>
                    ))}
                  </ol>
                }
              />
              {layer.worked_example.tip ? (
                <p>
                  <Inline text={layer.worked_example.tip} />
                </p>
              ) : null}
            </Section>
          ) : null}

          <Section heading="Check your understanding">
            <div className="grid gap-3">
              {note.checks.map((c, i) => (
                <Reveal
                  key={i}
                  q={c.q}
                  marks={c.marks}
                  a={
                    <p>
                      <Inline text={c.a} />
                    </p>
                  }
                />
              ))}
            </div>
          </Section>
        </div>
      </article>
    </div>
  );
}
