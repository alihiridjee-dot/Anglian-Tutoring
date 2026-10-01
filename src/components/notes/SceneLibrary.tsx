import { useReducedMotion } from "motion/react";
import { ElectrolysisCell } from "@/components/notes/NoteScenes";
import type {
  EnergyProfileScene,
  PredictorScene,
  SceneColour,
  TubesScene,
} from "@/lib/notes/noteFormat";

/**
 * The second set of illustrated scenes: chemistry colours and profiles, and
 * physics and biology slider scenes. Like NoteScenes, they are drawn once here
 * and a note only fills in names and numbers. Motion stops under reduced motion.
 */

const fmtNum = (n: number) => String(+n.toFixed(2));

/** Real-world colours for chemistry scenes. Fixed values: an iodine test is blue-black in any theme. */
const SCENE_FILL: Record<SceneColour, string> = {
  colourless: "oklch(0.97 0.01 220 / 0.5)",
  white: "oklch(0.98 0 0)",
  cream: "oklch(0.93 0.05 90)",
  "pale-yellow": "oklch(0.94 0.09 100)",
  yellow: "oklch(0.88 0.17 98)",
  orange: "oklch(0.76 0.17 60)",
  "orange-red": "oklch(0.68 0.2 40)",
  "brick-red": "oklch(0.55 0.17 32)",
  red: "oklch(0.6 0.22 27)",
  crimson: "oklch(0.5 0.21 15)",
  pink: "oklch(0.8 0.12 350)",
  purple: "oklch(0.5 0.2 310)",
  lilac: "oklch(0.75 0.12 305)",
  blue: "oklch(0.58 0.17 250)",
  "pale-blue": "oklch(0.83 0.08 235)",
  "blue-black": "oklch(0.28 0.08 265)",
  green: "oklch(0.62 0.17 145)",
  "pale-green": "oklch(0.86 0.1 140)",
  "green-blue": "oklch(0.62 0.12 195)",
  brown: "oklch(0.45 0.08 50)",
  black: "oklch(0.2 0 0)",
  grey: "oklch(0.65 0.01 250)",
};

// ── Test tubes ──────────────────────────────────────────────────────────────

export function TubesView({ s }: { s: TubesScene }) {
  const still = !!useReducedMotion();
  const w = 70,
    gap = 26;
  const W = Math.max(260, s.tubes.length * (w + gap) + gap);
  const x0 = (W - (s.tubes.length * (w + gap) - gap)) / 2;
  return (
    <svg
      viewBox={`0 0 ${W} 225`}
      className="mx-auto w-full max-w-[560px]"
      role="img"
      aria-label={s.tubes
        .map(
          (t) => `${t.label}: ${t.colour}${t.precipitate ? `, ${t.precipitate} precipitate` : ""}`,
        )
        .join("; ")}
    >
      {s.tubes.map((t, i) => {
        const x = x0 + i * (w + gap);
        const r = w / 2 - 10;
        return (
          <g key={i}>
            <path
              d={`M${x + 10} 20 V150 a${r} ${r} 0 0 0 ${w - 20} 0 V20`}
              fill="var(--card)"
              stroke="var(--foreground)"
              strokeOpacity=".55"
              strokeWidth="2.5"
            />
            <path
              d={`M${x + 12} 80 V150 a${r - 2} ${r - 2} 0 0 0 ${w - 24} 0 V80 Z`}
              fill={SCENE_FILL[t.colour]}
              style={{ transition: "fill .4s" }}
            />
            {t.precipitate ? (
              <path
                d={`M${x + 13} 150 a${r - 3} ${r - 3} 0 0 0 ${w - 26} 0 Z`}
                fill={SCENE_FILL[t.precipitate]}
                stroke="var(--foreground)"
                strokeOpacity=".2"
              />
            ) : null}
            {t.bubbles
              ? [0, 1, 2].map((b) => (
                  <circle
                    key={b}
                    cx={x + w / 2 + (b - 1) * 10}
                    cy={150 - b * 20}
                    r="3"
                    fill="none"
                    stroke="var(--foreground)"
                    strokeOpacity=".5"
                  >
                    {still ? null : (
                      <animate
                        attributeName="cy"
                        from={160}
                        to={85}
                        dur={`${1.2 + b * 0.3}s`}
                        repeatCount="indefinite"
                      />
                    )}
                  </circle>
                ))
              : null}
            <text
              x={x + w / 2}
              y={205}
              textAnchor="middle"
              fontSize="12"
              fontWeight="800"
              fill="var(--foreground)"
            >
              {t.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Flame test ──────────────────────────────────────────────────────────────

export function FlameView({ colour }: { colour: SceneColour }) {
  const still = !!useReducedMotion();
  return (
    <svg
      viewBox="0 0 200 215"
      className="mx-auto w-full max-w-[200px]"
      role="img"
      aria-label={`A ${colour} flame`}
    >
      <g style={{ transformOrigin: "100px 150px" }}>
        <path
          d="M100 30 C130 80 140 110 128 140 C120 160 80 160 72 140 C60 110 70 80 100 30 Z"
          fill={SCENE_FILL[colour]}
          opacity=".92"
        >
          {still ? null : (
            <animateTransform
              attributeName="transform"
              type="skewX"
              values="0;3;-2;0"
              dur="0.9s"
              repeatCount="indefinite"
            />
          )}
        </path>
      </g>
      <path
        d="M100 88 C111 110 113 127 108 139 C104 147 96 147 92 139 C87 127 89 110 100 88 Z"
        fill="oklch(0.78 0.1 250)"
        opacity=".6"
      />
      <rect x="86" y="150" width="28" height="42" rx="4" fill="var(--foreground)" opacity=".7" />
      <rect x="66" y="192" width="68" height="12" rx="4" fill="var(--foreground)" opacity=".7" />
      <line
        x1="34"
        y1="118"
        x2="92"
        y2="128"
        stroke="var(--foreground)"
        strokeOpacity=".6"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <text x="34" y="110" fontSize="10" fontWeight="800" fill="var(--foreground)">
        wire loop
      </text>
    </svg>
  );
}

// ── Energy profile ──────────────────────────────────────────────────────────

export function EnergyProfileView({ s }: { s: EnergyProfileScene }) {
  const exo = s.direction === "exothermic";
  const R = exo ? 120 : 165,
    P = exo ? 165 : 110,
    peak = 50,
    cat = 88;
  const path = (top: number) =>
    `M50 ${R} H120 C165 ${R}, 175 ${top}, 210 ${top} S255 ${P}, 300 ${P} H370`;
  return (
    <svg
      viewBox="0 0 420 230"
      className="mx-auto w-full max-w-[520px]"
      role="img"
      aria-label={`${exo ? "Exothermic" : "Endothermic"} reaction profile${s.catalyst ? ", with the lower path a catalyst gives" : ""}`}
    >
      <line
        x1="40"
        y1="20"
        x2="40"
        y2="200"
        stroke="var(--foreground)"
        strokeOpacity=".5"
        strokeWidth="2"
      />
      <line
        x1="40"
        y1="200"
        x2="405"
        y2="200"
        stroke="var(--foreground)"
        strokeOpacity=".5"
        strokeWidth="2"
      />
      <text
        x="20"
        y="110"
        transform="rotate(-90 20 110)"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fill="var(--foreground)"
      >
        Energy
      </text>
      <text
        x="220"
        y="220"
        textAnchor="middle"
        fontSize="12"
        fontWeight="700"
        fill="var(--foreground)"
      >
        Progress of reaction
      </text>
      <path d={path(peak)} fill="none" stroke="var(--tint)" strokeWidth="3.5" />
      {s.catalyst ? (
        <path
          d={path(cat)}
          fill="none"
          stroke="var(--tint)"
          strokeWidth="2.5"
          strokeDasharray="6 5"
          opacity=".8"
        />
      ) : null}
      <text
        x="85"
        y={R - 8}
        textAnchor="middle"
        fontSize="12"
        fontWeight="800"
        fill="var(--foreground)"
      >
        Reactants
      </text>
      <text
        x="300"
        y={P + (exo ? 18 : -8)}
        textAnchor="middle"
        fontSize="12"
        fontWeight="800"
        fill="var(--foreground)"
      >
        Products
      </text>
      <g className="tint-amber">
        <line x1="150" y1={R} x2="150" y2={peak + 2} stroke="var(--tint)" strokeWidth="2" />
        <text
          x="145"
          y={(R + peak) / 2 + 4}
          textAnchor="end"
          fontSize="11"
          fontWeight="800"
          fill="color-mix(in oklab, var(--tint) 70%, var(--primary-deep))"
        >
          Activation
        </text>
        <text
          x="145"
          y={(R + peak) / 2 + 17}
          textAnchor="end"
          fontSize="11"
          fontWeight="800"
          fill="color-mix(in oklab, var(--tint) 70%, var(--primary-deep))"
        >
          energy
        </text>
      </g>
      <g className={exo ? "tint-rose" : "tint-primary"}>
        <line x1="388" y1={R} x2="388" y2={P} stroke="var(--tint)" strokeWidth="2.5" />
        <line
          x1="300"
          y1={R}
          x2="390"
          y2={R}
          stroke="var(--tint)"
          strokeOpacity=".5"
          strokeDasharray="4 3"
        />
        <text
          x="380"
          y={(R + P) / 2 + 4}
          textAnchor="end"
          fontSize="11"
          fontWeight="800"
          fill="var(--tint)"
        >
          {exo ? "energy released" : "energy taken in"}
        </text>
      </g>
      {s.catalyst ? (
        <text
          x="210"
          y={cat + 16}
          textAnchor="middle"
          fontSize="11"
          fontWeight="800"
          fill="var(--tint)"
        >
          catalyst
        </text>
      ) : null}
    </svg>
  );
}

export function PredictorSceneView({ s }: { s: PredictorScene }) {
  if (s.kind === "electrolysis") return <ElectrolysisCell s={s} />;
  if (s.kind === "tubes") return <TubesView s={s} />;
  if (s.kind === "flame") return <FlameView colour={s.colour} />;
  return <EnergyProfileView s={s} />;
}

// ── Half-life ───────────────────────────────────────────────────────────────

/** The same nuclei always decay in the same order, so sliding back and forth stays consistent. */
const DECAY_ORDER = Array.from({ length: 100 }, (_, i) => (i * 37 + 11) % 100);

export function HalfLifeView({ time, halfLife }: { time: number; halfLife: number }) {
  const remaining = Math.round(100 * 0.5 ** (Math.max(0, time) / halfLife));
  const decayed = new Set(DECAY_ORDER.slice(0, 100 - remaining));
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[240px_1fr]">
      <svg
        viewBox="0 0 220 220"
        className="w-full max-w-[260px]"
        role="img"
        aria-label={`${remaining} of 100 nuclei not yet decayed`}
      >
        {Array.from({ length: 100 }, (_, i) => (
          <circle
            key={i}
            cx={15 + (i % 10) * 21}
            cy={15 + Math.floor(i / 10) * 21}
            r="8"
            fill={
              decayed.has(i)
                ? "color-mix(in oklab, var(--foreground) 14%, var(--card))"
                : "var(--tint)"
            }
            style={{ transition: "fill .3s" }}
          />
        ))}
      </svg>
      <div aria-live="polite">
        <p className="font-display text-2xl font-extrabold">
          <span className="numeral">{remaining}</span> of 100 left
        </p>
        <p className="mt-1">
          After {fmtNum(time / halfLife)} half-lives. Coloured nuclei have not decayed yet.
        </p>
      </div>
    </div>
  );
}

// ── Gas syringe ─────────────────────────────────────────────────────────────

export function GasSyringeView({
  volume,
  max,
  rate,
}: {
  volume: number;
  max: number;
  rate?: number;
}) {
  const still = !!useReducedMotion();
  const f = Math.max(0, Math.min(1, volume / max));
  const fizz = rate == null ? 1.2 : Math.max(0.3, Math.min(3, 2 / Math.max(rate, 0.05)));
  const L = 256;
  return (
    <svg
      viewBox="0 0 500 170"
      className="mx-auto w-full max-w-[560px]"
      role="img"
      aria-label={`${fmtNum(volume)} cm³ of gas collected, out of ${max} cm³`}
    >
      <path
        d="M70 40 V80 L30 150 Q26 160 40 160 H140 Q154 160 150 150 L110 80 V40 Z"
        fill="var(--card)"
        stroke="var(--foreground)"
        strokeOpacity=".55"
        strokeWidth="2.5"
      />
      <path
        d="M58 112 L36 152 Q34 156 42 156 H138 Q146 156 144 152 L122 112 Z"
        fill="color-mix(in oklab, var(--tint) 18%, var(--card))"
      />
      {[0, 1, 2, 3].map((b) => (
        <circle
          key={b}
          cx={70 + b * 14}
          cy={150 - b * 8}
          r="3"
          fill="none"
          stroke="var(--tint)"
          strokeWidth="1.5"
        >
          {still ? null : (
            <animate
              attributeName="cy"
              from={154}
              to={114}
              dur={`${(fizz * (0.8 + b * 0.15)).toFixed(2)}s`}
              repeatCount="indefinite"
            />
          )}
        </circle>
      ))}
      <path
        d="M90 40 V24 H200 V62"
        fill="none"
        stroke="var(--foreground)"
        strokeOpacity=".55"
        strokeWidth="2.5"
      />
      <rect
        x="200"
        y="62"
        width={L + 4}
        height="36"
        rx="6"
        fill="var(--card)"
        stroke="var(--foreground)"
        strokeOpacity=".55"
        strokeWidth="2.5"
      />
      <rect
        x="202"
        y="64"
        width={L * f}
        height="32"
        rx="4"
        fill="color-mix(in oklab, var(--tint) 30%, var(--card))"
        style={{ transition: "width .4s" }}
      />
      <rect
        x={200 + L * f}
        y="58"
        width="8"
        height="44"
        rx="2"
        fill="var(--foreground)"
        opacity=".7"
        style={{ transition: "x .4s" }}
      />
      <rect
        x={208 + L * f}
        y="76"
        width={Math.max(0, 290 - L * f)}
        height="8"
        fill="var(--foreground)"
        opacity=".45"
        style={{ transition: "all .4s" }}
      />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line
            x1={202 + L * t}
            y1="98"
            x2={202 + L * t}
            y2="106"
            stroke="var(--foreground)"
            strokeOpacity=".5"
          />
          <text
            x={202 + L * t}
            y="121"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="var(--foreground)"
          >
            {fmtNum(max * t)}
          </text>
        </g>
      ))}
      <text
        x="330"
        y="148"
        textAnchor="middle"
        fontSize="13"
        fontWeight="800"
        fill="var(--foreground)"
      >
        Gas collected: {fmtNum(volume)} cm³
      </text>
    </svg>
  );
}

// ── Circuit ─────────────────────────────────────────────────────────────────

function Bulb({ x, y, glow }: { x: number; y: number; glow: number }) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={28}
        fill="oklch(0.92 0.17 95)"
        opacity={0.1 + glow * 0.75}
        style={{ transition: "opacity .3s" }}
      />
      <circle
        cx={x}
        cy={y}
        r="14"
        fill="var(--card)"
        stroke="var(--foreground)"
        strokeOpacity=".7"
        strokeWidth="2"
      />
      <path
        d={`M${x - 9} ${y - 9} L${x + 9} ${y + 9} M${x + 9} ${y - 9} L${x - 9} ${y + 9}`}
        stroke="var(--foreground)"
        strokeOpacity=".7"
        strokeWidth="2"
      />
    </g>
  );
}

export function CircuitView({
  arrangement,
  brightness,
  max,
}: {
  arrangement: "series" | "parallel";
  brightness: number;
  max: number;
}) {
  const glow = Math.max(0, Math.min(1, brightness / max));
  const wire = { fill: "none", stroke: "var(--foreground)", strokeOpacity: 0.6, strokeWidth: 2.5 };
  return (
    <svg
      viewBox="0 0 360 200"
      className="mx-auto w-full max-w-[400px]"
      role="img"
      aria-label={`Two bulbs in ${arrangement}, at ${Math.round(glow * 100)}% brightness`}
    >
      {arrangement === "series" ? (
        <>
          <path d="M170 175 H40 V40 H320 V175 H186" {...wire} />
          <Bulb x={130} y={40} glow={glow} />
          <Bulb x={230} y={40} glow={glow} />
        </>
      ) : (
        <>
          <path d="M170 175 H40 V30 H320 V175 H186 M40 105 H320" {...wire} />
          <Bulb x={180} y={30} glow={glow} />
          <Bulb x={180} y={105} glow={glow} />
        </>
      )}
      <rect x="168" y="160" width="20" height="30" fill="var(--card)" />
      <line
        x1="171"
        y1="160"
        x2="171"
        y2="190"
        stroke="var(--foreground)"
        strokeWidth="3"
        opacity=".75"
      />
      <line
        x1="185"
        y1="166"
        x2="185"
        y2="184"
        stroke="var(--foreground)"
        strokeWidth="5"
        opacity=".75"
      />
      <text
        x="178"
        y="152"
        textAnchor="middle"
        fontSize="11"
        fontWeight="800"
        fill="var(--foreground)"
      >
        cell
      </text>
      <text
        x="300"
        y="196"
        textAnchor="end"
        fontSize="11"
        fontWeight="800"
        fill="var(--foreground)"
      >
        {arrangement === "series" ? "Series" : "Parallel"}
      </text>
    </svg>
  );
}

// ── Enzyme ──────────────────────────────────────────────────────────────────

export function EnzymeView({
  value,
  optimum,
  denaturesAt,
}: {
  value: number;
  optimum: number;
  denaturesAt: number;
}) {
  const off = Math.min(1, Math.abs(value - optimum) / denaturesAt);
  const denatured = off >= 1;
  const fits = off < 0.3;
  const bend = off * 16;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[260px_1fr]">
      <svg
        viewBox="0 0 260 170"
        className="w-full max-w-[280px]"
        role="img"
        aria-label={
          denatured
            ? "Denatured: the active site has changed shape"
            : fits
              ? "The substrate fits the active site"
              : "The active site is changing shape"
        }
      >
        <path
          d={`M40 150 Q30 62 108 52 L${116 - bend} ${80 + bend / 2} Q130 ${100 + bend} ${144 + bend} ${80 + bend / 2} L152 52 Q230 62 220 150 Z`}
          fill="color-mix(in oklab, var(--tint) 35%, var(--card))"
          stroke="var(--tint)"
          strokeWidth="2.5"
        />
        <g
          style={{
            transform: fits ? "none" : "translate(42px, -22px) rotate(18deg)",
            transformOrigin: "130px 50px",
            transition: "transform .4s",
          }}
        >
          <path
            d="M112 32 L118 56 Q130 74 142 56 L148 32 Z"
            fill="oklch(0.75 0.15 60)"
            stroke="var(--foreground)"
            strokeOpacity=".4"
          />
        </g>
        <text
          x="130"
          y="135"
          textAnchor="middle"
          fontSize="12"
          fontWeight="800"
          fill="var(--foreground)"
        >
          Enzyme
        </text>
        <text
          x="130"
          y="22"
          textAnchor="middle"
          fontSize="11"
          fontWeight="800"
          fill="var(--foreground)"
        >
          Substrate
        </text>
      </svg>
      <div aria-live="polite">
        <p className="font-display text-2xl font-extrabold">
          {denatured ? "Denatured" : fits ? "Substrate fits" : "Active site changing shape"}
        </p>
        <p className="mt-1">
          {denatured
            ? "The active site has changed shape for good. The substrate no longer fits, so the reaction stops."
            : fits
              ? "Near the optimum, the substrate fits the active site and the reaction is fastest."
              : "Away from the optimum, the active site changes shape, so the substrate fits less well and the rate falls."}
        </p>
      </div>
    </div>
  );
}

// ── Diffusion ───────────────────────────────────────────────────────────────

export function DiffusionView({
  left,
  right,
  top,
  membrane = "Membrane",
}: {
  left: number;
  right: number;
  top: number;
  membrane?: string;
}) {
  const still = !!useReducedMotion();
  const nL = Math.round((Math.max(0, left) / top) * 20),
    nR = Math.round((Math.max(0, right) / top) * 20);
  const net = nL - nR;
  const dur = Math.max(0.8, 4 - Math.abs(net) * 0.15);
  // A jittered 5 × 4 grid on each side, filled in a scattered order, so particles never bunch.
  const SLOTS = [7, 13, 1, 18, 10, 4, 16, 2, 11, 19, 6, 14, 0, 9, 17, 3, 12, 8, 15, 5];
  const dot = (i: number, side: 0 | 1) => {
    const s = SLOTS[i % 20];
    const jx = ((s * 13) % 11) - 5,
      jy = ((s * 7) % 11) - 5;
    return [(side === 0 ? 26 : 216) + (s % 5) * 34 + jx, 24 + Math.floor(s / 5) * 36 + jy];
  };
  return (
    <svg
      viewBox="0 0 380 190"
      className="mx-auto w-full max-w-[480px]"
      role="img"
      aria-label={`${nL} particles on the left, ${nR} on the right; net movement ${net > 0 ? "to the right" : net < 0 ? "to the left" : "none"}`}
    >
      <rect
        x="5"
        y="5"
        width="370"
        height="160"
        rx="10"
        fill="color-mix(in oklab, var(--tint) 6%, var(--card))"
        stroke="color-mix(in oklab, var(--tint) 35%, transparent)"
        strokeWidth="2"
      />
      <line
        x1="190"
        y1="5"
        x2="190"
        y2="165"
        stroke="var(--foreground)"
        strokeOpacity=".55"
        strokeWidth="3"
        strokeDasharray="10 6"
      />
      {Array.from({ length: nL }, (_, i) => {
        const [x, y] = dot(i, 0);
        return <circle key={`l${i}`} cx={x} cy={y} r="6" fill="var(--tint)" />;
      })}
      {Array.from({ length: nR }, (_, i) => {
        const [x, y] = dot(i, 1);
        return <circle key={`r${i}`} cx={x} cy={y} r="6" fill="var(--tint)" />;
      })}
      {net !== 0 && !still ? (
        <circle cx={net > 0 ? 170 : 210} cy="88" r="6" fill="var(--tint)">
          <animate
            attributeName="cx"
            from={net > 0 ? 160 : 220}
            to={net > 0 ? 230 : 150}
            dur={`${dur}s`}
            repeatCount="indefinite"
          />
        </circle>
      ) : null}
      <text
        x="190"
        y="183"
        textAnchor="middle"
        fontSize="12"
        fontWeight="800"
        fill="var(--foreground)"
      >
        {net === 0
          ? `${membrane}: no net movement`
          : `${membrane}: net movement ${net > 0 ? "→" : "←"}, from high to low concentration`}
      </text>
    </svg>
  );
}

// ── pH scale ────────────────────────────────────────────────────────────────

const UI_COLOURS = [
  "oklch(0.55 0.21 27)",
  "oklch(0.6 0.21 32)",
  "oklch(0.68 0.19 45)",
  "oklch(0.75 0.17 60)",
  "oklch(0.83 0.16 80)",
  "oklch(0.88 0.16 100)",
  "oklch(0.8 0.17 125)",
  "oklch(0.7 0.17 145)",
  "oklch(0.65 0.13 170)",
  "oklch(0.6 0.12 200)",
  "oklch(0.55 0.14 235)",
  "oklch(0.48 0.16 260)",
  "oklch(0.42 0.17 280)",
  "oklch(0.38 0.17 295)",
  "oklch(0.34 0.15 305)",
];

export function PhScaleView({ ph }: { ph: number }) {
  const p = Math.max(0, Math.min(14, ph));
  const word =
    p < 7
      ? p <= 3
        ? "strongly acidic"
        : "weakly acidic"
      : p === 7
        ? "neutral"
        : p >= 11
          ? "strongly alkaline"
          : "weakly alkaline";
  const x = 20 + (p / 14) * 420;
  return (
    <svg
      viewBox="0 0 460 120"
      className="mx-auto w-full max-w-[560px]"
      role="img"
      aria-label={`pH ${fmtNum(p)}, ${word}`}
    >
      {UI_COLOURS.map((c, i) => (
        <rect key={i} x={20 + i * 28} y="40" width="28.5" height="30" fill={c} />
      ))}
      {Array.from({ length: 15 }, (_, i) => (
        <text
          key={i}
          x={34 + i * 28}
          y="88"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="var(--foreground)"
        >
          {i}
        </text>
      ))}
      <g style={{ transform: `translateX(${x - 20}px)`, transition: "transform .3s" }}>
        <path d="M20 36 L12 22 H28 Z" fill="var(--foreground)" />
        <rect x="18.5" y="38" width="3" height="34" fill="var(--foreground)" />
      </g>
      <text
        x={Math.min(Math.max(x, 80), 380)}
        y="15"
        textAnchor="middle"
        fontSize="13"
        fontWeight="800"
        fill="var(--foreground)"
      >
        pH {fmtNum(p)}: {word}
      </text>
      <text x="20" y="110" fontSize="11" fontWeight="800" fill="var(--foreground)">
        Acid
      </text>
      <text
        x="230"
        y="110"
        textAnchor="middle"
        fontSize="11"
        fontWeight="800"
        fill="var(--foreground)"
      >
        Neutral
      </text>
      <text
        x="440"
        y="110"
        textAnchor="end"
        fontSize="11"
        fontWeight="800"
        fill="var(--foreground)"
      >
        Alkali
      </text>
    </svg>
  );
}
