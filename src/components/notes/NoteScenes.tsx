import { useReducedMotion } from "motion/react";
import type { ElectrolysisScene } from "@/lib/notes/noteFormat";

/**
 * Illustrated scenes for interactive diagrams. They are drawn here, once, and a
 * note only fills in the numbers and names — so every note's picture is as
 * finished as the first. All motion stops for students who ask for reduced motion.
 */

// ── Electrolysis cell ───────────────────────────────────────────────────────

const METAL = {
  copper: "oklch(0.62 0.12 45)",
  silver: "oklch(0.8 0.01 250)",
  grey: "oklch(0.6 0.01 250)",
};
const SOLUTION = {
  orange: "oklch(0.72 0.15 55)",
  brown: "oklch(0.45 0.08 50)",
  green: "oklch(0.8 0.14 125)",
};

function Bubbles({ x, dir, still }: { x: number; dir: 1 | -1; still: boolean }) {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <circle
          key={i}
          cx={x + dir * (i % 2) * 8}
          cy={230 - i * 24}
          r={4 + (i % 2)}
          fill="none"
          stroke="var(--tint)"
          strokeWidth="1.5"
        >
          {still ? null : (
            <animate
              attributeName="cy"
              from={240 - i * 24}
              to={130}
              dur={`${1.6 + i * 0.3}s`}
              repeatCount="indefinite"
            />
          )}
        </circle>
      ))}
    </>
  );
}

export function ElectrolysisCell({ s }: { s: ElectrolysisScene }) {
  const still = !!useReducedMotion();
  const ions = [
    { t: s.ions[0], x: 250, y: 170, to: 185, tint: "tint-primary" },
    { t: s.ions[1], x: 270, y: 200, to: 335, tint: "tint-rose" },
    ...(s.molten
      ? []
      : [
          { t: "H⁺", x: 230, y: 240, to: 185, tint: "tint-primary" },
          { t: "OH⁻", x: 290, y: 262, to: 335, tint: "tint-rose" },
        ]),
  ];
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <svg
        viewBox="0 0 520 300"
        className="w-full min-w-[460px]"
        role="img"
        aria-label={`Electrolysis: ${s.negative.product} at the negative electrode, ${s.positive.product} at the positive electrode`}
      >
        <rect
          x="215"
          y="8"
          width="90"
          height="34"
          rx="10"
          fill="var(--card)"
          stroke="var(--edge)"
          strokeWidth="2"
        />
        <text
          x="260"
          y="30"
          textAnchor="middle"
          fontSize="13"
          fontWeight="800"
          fill="var(--foreground)"
        >
          d.c. supply
        </text>
        <path
          d="M215 25 H150 V90 M305 25 H370 V90"
          fill="none"
          stroke="var(--foreground)"
          strokeOpacity=".5"
          strokeWidth="2"
        />
        <path
          d="M90 80 V270 Q90 286 106 286 H414 Q430 286 430 270 V80"
          fill="none"
          stroke="var(--foreground)"
          strokeOpacity=".55"
          strokeWidth="3"
        />
        <rect
          x="92"
          y="120"
          width="336"
          height="164"
          rx="10"
          fill="color-mix(in oklab, var(--tint) 12%, var(--card))"
        />
        <g className="tint-primary">
          <rect
            x="140"
            y="90"
            width="20"
            height="160"
            rx="4"
            fill="color-mix(in oklab, var(--tint) 35%, var(--card))"
            stroke="var(--tint)"
            strokeWidth="2"
          />
          <text
            x="150"
            y="112"
            textAnchor="middle"
            fontSize="18"
            fontWeight="900"
            fill="var(--tint)"
          >
            −
          </text>
          {s.negative.form === "gas" ? (
            <Bubbles x={168} dir={1} still={still} />
          ) : (
            <rect
              x="136"
              y="150"
              width="28"
              height="100"
              rx="6"
              fill={METAL[s.negative.metal ?? "grey"]}
              opacity=".9"
            />
          )}
          <rect x="8" y="140" width="112" height="40" rx="12" fill="var(--tint)" />
          <text x="64" y="166" textAnchor="middle" fontSize="15" fontWeight="900" fill="white">
            {s.negative.product}
          </text>
        </g>
        <g className="tint-rose">
          <rect
            x="360"
            y="90"
            width="20"
            height="160"
            rx="4"
            fill="color-mix(in oklab, var(--tint) 35%, var(--card))"
            stroke="var(--tint)"
            strokeWidth="2"
          />
          <text
            x="370"
            y="112"
            textAnchor="middle"
            fontSize="18"
            fontWeight="900"
            fill="var(--tint)"
          >
            +
          </text>
          {s.positive.form === "gas" ? (
            <Bubbles x={352} dir={-1} still={still} />
          ) : (
            <ellipse
              cx="345"
              cy="215"
              rx="30"
              ry="34"
              fill={SOLUTION[s.positive.colour ?? "brown"]}
              opacity=".35"
            />
          )}
          <rect x="400" y="140" width="112" height="40" rx="12" fill="var(--tint)" />
          <text x="456" y="166" textAnchor="middle" fontSize="15" fontWeight="900" fill="white">
            {s.positive.product}
          </text>
        </g>
        {ions.map((ion) => (
          <g key={ion.t + ion.y} className={ion.tint}>
            <text
              x={ion.x}
              y={ion.y}
              textAnchor="middle"
              fontSize="14"
              fontWeight="800"
              fill="var(--tint)"
            >
              {ion.t}
              {still ? null : (
                <animate
                  attributeName="x"
                  values={`${ion.x};${ion.to};${ion.x}`}
                  dur="5s"
                  repeatCount="indefinite"
                />
              )}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Road ────────────────────────────────────────────────────────────────────

export function RoadScene({ thinking, braking }: { thinking: number; braking: number }) {
  const W = 600;
  const t = Math.max(0, thinking),
    b = Math.max(0, braking);
  const scale = Math.max(120, (t + b) * 1.08);
  const px = (m: number) => (m / scale) * (W - 70);
  const tx = 50 + px(t);
  const bx = tx + px(b);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <svg
        viewBox={`0 4 ${W + 20} 146`}
        className="w-full min-w-[520px]"
        role="img"
        aria-label={`Thinking distance ${t.toFixed(0)} metres, then braking distance ${b.toFixed(0)} metres`}
      >
        <rect
          x="0"
          y="62"
          width={W + 20}
          height="56"
          rx="10"
          fill="color-mix(in oklab, var(--foreground) 8%, var(--card))"
        />
        <line
          x1="0"
          y1="90"
          x2={W + 20}
          y2="90"
          stroke="var(--card)"
          strokeWidth="3"
          strokeDasharray="18 14"
        />
        <g className="tint-amber">
          <rect
            x="50"
            y="66"
            width={px(t)}
            height="48"
            fill="color-mix(in oklab, var(--tint) 45%, transparent)"
            style={{ transition: "width .35s" }}
          />
          <text
            x="50"
            y="26"
            fontSize="13"
            fontWeight="800"
            fill="color-mix(in oklab, var(--tint) 70%, var(--primary-deep))"
          >
            Thinking {t.toFixed(0)} m
          </text>
        </g>
        <g className="tint-rose">
          <rect
            x={tx}
            y="66"
            width={px(b)}
            height="48"
            fill="color-mix(in oklab, var(--tint) 40%, transparent)"
            style={{ transition: "all .35s" }}
          />
          <text
            x={Math.min(tx, W - 110)}
            y="50"
            fontSize="13"
            fontWeight="800"
            fill="var(--tint)"
            style={{ transition: "x .35s" }}
          >
            Braking {b.toFixed(0)} m
          </text>
        </g>
        <line
          x1={bx}
          y1="58"
          x2={bx}
          y2="122"
          stroke="var(--foreground)"
          strokeWidth="3"
          style={{ transition: "all .35s" }}
        />
        <text
          x={bx}
          y="140"
          textAnchor="middle"
          fontSize="12"
          fontWeight="800"
          fill="var(--foreground)"
          style={{ transition: "x .35s" }}
        >
          Stops
        </text>
        <text
          x="50"
          y="140"
          textAnchor="middle"
          fontSize="12"
          fontWeight="800"
          fill="var(--foreground)"
        >
          Sees hazard
        </text>
        <line
          x1={tx}
          y1="62"
          x2={tx}
          y2="118"
          stroke="var(--foreground)"
          strokeOpacity=".5"
          strokeWidth="2"
          strokeDasharray="4 3"
          style={{ transition: "all .35s" }}
        />
        <g className="tint-phys" transform="translate(8 74)">
          <rect x="0" y="4" width="40" height="22" rx="6" fill="var(--tint)" />
          <rect x="8" y="0" width="22" height="12" rx="4" fill="var(--tint)" />
          <circle cx="10" cy="28" r="5" fill="var(--foreground)" />
          <circle cx="31" cy="28" r="5" fill="var(--foreground)" />
        </g>
      </svg>
    </div>
  );
}

// ── Wave ────────────────────────────────────────────────────────────────────

/**
 * A transverse wave. Amplitude and frequency are shown relative to the
 * slider's own range, so the picture spans "small" to "large" whatever the units.
 */
export function WaveScene({ amplitude, frequency }: { amplitude: number; frequency: number }) {
  const still = !!useReducedMotion();
  const W = 600,
    mid = 90;
  const A = 12 + amplitude * 58; // 0–1 → px
  const cycles = 1 + frequency * 5; // 0–1 → 1–6 waves across
  const lambda = W / cycles;
  const pts: string[] = [];
  for (let x = 0; x <= W + lambda; x += 4)
    pts.push(`${x},${(mid - A * Math.sin((2 * Math.PI * x) / lambda)).toFixed(1)}`);
  const x0 = lambda * 0.25; // first crest
  const xt = lambda * 0.75; // first trough
  // A point on the wave bobs up and down: the wave moves along, the medium doesn't.
  const xp = W - 40;
  const yAt = (x: number) => mid - A * Math.sin((2 * Math.PI * x) / lambda);
  const period = (2.4 / cycles).toFixed(2);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <svg
        viewBox={`0 0 ${W} 200`}
        className="w-full min-w-[480px]"
        role="img"
        aria-label={`A transverse wave with ${cycles.toFixed(1)} wavelengths across the screen, its wavelength and amplitude marked`}
      >
        <line
          x1="0"
          y1={mid}
          x2={W}
          y2={mid}
          stroke="var(--foreground)"
          strokeOpacity=".25"
          strokeDasharray="5 5"
        />
        <polyline
          points={pts.filter((p) => +p.split(",")[0] <= W).join(" ")}
          fill="none"
          stroke="var(--tint)"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        {/* wavelength: crest to crest */}
        <g className="tint-rose">
          <line
            x1={x0}
            y1={mid - A - 14}
            x2={x0 + lambda}
            y2={mid - A - 14}
            stroke="var(--tint)"
            strokeWidth="2"
          />
          <line
            x1={x0}
            y1={mid - A - 20}
            x2={x0}
            y2={mid - A - 8}
            stroke="var(--tint)"
            strokeWidth="2"
          />
          <line
            x1={x0 + lambda}
            y1={mid - A - 20}
            x2={x0 + lambda}
            y2={mid - A - 8}
            stroke="var(--tint)"
            strokeWidth="2"
          />
          <text
            x={x0 + lambda / 2}
            y={mid - A - 20}
            textAnchor="middle"
            fontSize="13"
            fontWeight="800"
            fill="var(--tint)"
          >
            wavelength
          </text>
        </g>
        {/* amplitude: rest line to trough, labelled underneath */}
        <g className="tint-amber">
          <line x1={xt} y1={mid} x2={xt} y2={mid + A} stroke="var(--tint)" strokeWidth="2.5" />
          <text
            x={xt}
            y={mid + A + 18}
            textAnchor="middle"
            fontSize="13"
            fontWeight="800"
            fill="color-mix(in oklab, var(--tint) 70%, var(--primary-deep))"
          >
            amplitude
          </text>
        </g>
        {/* one point of the medium */}
        <g className="tint-chem">
          <line
            x1={xp}
            y1={mid - A - 4}
            x2={xp}
            y2={mid + A + 4}
            stroke="var(--tint)"
            strokeOpacity=".35"
            strokeDasharray="3 3"
          />
          <circle cx={xp} cy={yAt(xp)} r="7" fill="var(--tint)">
            {still ? null : (
              <animate
                attributeName="cy"
                values={`${mid - A};${mid + A};${mid - A}`}
                dur={`${period}s`}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
              />
            )}
          </circle>
        </g>
      </svg>
      <p className="mt-1 text-sm font-bold">
        The purple point shows the medium moving up and down while the wave travels along.
      </p>
    </div>
  );
}

// ── Particles ───────────────────────────────────────────────────────────────

const GRID = Array.from({ length: 16 }, (_, i) => ({ c: i % 4, r: Math.floor(i / 4) }));
// Fixed scatter positions, so server and browser draw the same picture.
const LIQUID = [
  [70, 150],
  [100, 160],
  [132, 152],
  [162, 158],
  [86, 128],
  [118, 132],
  [150, 126],
  [178, 136],
  [66, 110],
  [98, 104],
  [130, 108],
  [160, 102],
  [190, 112],
  [76, 84],
  [140, 82],
  [184, 88],
];
// Gas: spread over the whole box on a jittered 4 × 4 grid, so no two overlap.
const GAS = GRID.map(({ c, r }, i) => [
  42 + c * 60 + ((i * 13) % 17) - 8,
  34 + r * 40 + ((i * 7) % 13) - 6,
]);

export function ParticlesScene({
  temperature,
  melting,
  boiling,
  unit = "°C",
}: {
  temperature: number;
  melting: number;
  boiling: number;
  unit?: string;
}) {
  const still = !!useReducedMotion();
  const state = temperature < melting ? "Solid" : temperature < boiling ? "Liquid" : "Gas";
  const jiggle = state === "Solid" ? 2 : state === "Liquid" ? 7 : 16;
  const speed = Math.max(
    0.25,
    1.6 - Math.min(1.3, Math.abs(temperature - melting) / Math.max(1, boiling - melting)),
  );
  const pos = (i: number) =>
    state === "Solid"
      ? [80 + GRID[i].c * 34, 70 + GRID[i].r * 30]
      : state === "Liquid"
        ? LIQUID[i]
        : GAS[i];
  const words = {
    Solid: "Particles are in fixed positions in a regular pattern. They vibrate.",
    Liquid: "Particles touch but move around each other, randomly.",
    Gas: "Particles are far apart and move quickly in all directions.",
  }[state];
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[260px_1fr]">
      <svg
        viewBox="0 0 270 190"
        className="w-full max-w-[300px]"
        role="img"
        aria-label={`${state}: ${words}`}
      >
        <rect
          x="10"
          y="10"
          width="250"
          height="170"
          rx="12"
          fill="color-mix(in oklab, var(--tint) 7%, var(--card))"
          stroke="color-mix(in oklab, var(--tint) 35%, transparent)"
          strokeWidth="2"
        />
        {GRID.map((_, i) => {
          const [x, y] = pos(i);
          const dx = (((i * 7) % 5) - 2) * jiggle * 0.5,
            dy = (((i * 3) % 5) - 2) * jiggle * 0.5;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="12"
              fill="var(--tint)"
              opacity=".85"
              style={{ transition: "cx .6s, cy .6s" }}
            >
              {still ? null : (
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values={`0 0; ${dx} ${dy}; ${-dy} ${dx}; 0 0`}
                  dur={`${(speed * (0.8 + (i % 3) * 0.15)).toFixed(2)}s`}
                  repeatCount="indefinite"
                />
              )}
            </circle>
          );
        })}
      </svg>
      <div aria-live="polite">
        <p className="font-display text-2xl font-extrabold">{state}</p>
        <p className="mt-1">{words}</p>
        <p className="mt-2 font-bold">
          Melts at {melting} {unit} · boils at {boiling} {unit}
        </p>
      </div>
    </div>
  );
}
