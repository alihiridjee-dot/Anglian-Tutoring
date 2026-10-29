import { MotionConfig, motion, useReducedMotion } from "motion/react";

import { Mascot, type MascotName, type Mood } from "@/components/Doodles";

/**
 * The doodle cast as one small group on the table in front of the student in
 * the hero photo, filling the box it is given: the cell and the bolt in front,
 * the flask a step further back between them. They pop up one after another,
 * then run a six-second routine for as long as the hero is up: a ripple left to
 * right, the flask backflips while the other two cheer, a ripple back, and one
 * jump all together. Their eyes follow whoever is moving. With reduced motion
 * they simply stand there.
 */

// One run of the routine, and when it starts: after they have all popped up.
const LOOP = 6;
const LOOP_START = 2;

type Ease = "linear" | "easeIn" | "easeOut" | "easeInOut";

/**
 * A pose at a moment: `lift` in doodle heights off the table, `sx`/`sy` squash
 * and stretch about the feet, `spin` in degrees (it carries on from the last
 * pose that set it, so turns add up), and the easing into the next pose.
 */
type Pose = { t: number; lift?: number; sx?: number; sy?: number; spin?: number; ease?: Ease };

/**
 * A jump: crouch, take off stretched, rise, fall, land squashed, rebound,
 * settle. Rising slows and falling speeds up, which is all gravity is.
 * `spin` turns it by that many degrees in the air.
 */
function hop(
  at: number,
  o: {
    height: number;
    air: number;
    crouch?: number;
    squash?: number;
    from?: number;
    spin?: number;
  },
): Pose[] {
  const crouch = o.crouch ?? 0.12;
  const squash = o.squash ?? 0.82;
  const from = o.from ?? 0;
  const to = from + (o.spin ?? 0);
  const dip = 1 - (1 - squash) * 0.7;
  const up = at + crouch;
  const down = up + o.air;
  return [
    { t: at, spin: from, ease: "easeOut" },
    { t: at + crouch * 0.8, sx: 2 - dip, sy: dip, ease: "easeIn" },
    { t: up, lift: 0.04, sx: 0.92, sy: 1.1, ease: "easeOut" },
    { t: up + o.air / 2, lift: o.height, spin: (from + to) / 2, ease: "easeIn" },
    { t: down - 0.04, lift: o.height * 0.1, sx: 0.94, sy: 1.08, spin: to, ease: "linear" },
    { t: down, sx: 2 - squash, sy: squash, ease: "easeOut" },
    { t: down + 0.12, lift: o.height * 0.06, sx: 0.97, sy: 1.04, ease: "easeIn" },
    { t: down + 0.22 },
  ];
}

const ripple = { height: 0.35, air: 0.34 };
const together = { height: 0.55, air: 0.44, crouch: 0.14 };

type Character = {
  name: MascotName;
  mood: Mood;
  // Centre and size, as fractions of the group's width.
  x: number;
  size: number;
  // How far back on the table it stands: its feet are raised by this fraction
  // of the group's height.
  back: number;
  // When it pops up, after the page starts.
  pop: number;
  poses: Pose[];
  // Where it looks: [time, x, y] in the drawing's own units.
  gaze: [number, number, number][];
  // Landings that kick up dust: [time, how hard].
  dust: [number, number][];
};

// The one at the back comes first, so the two in front paint over it.
const CAST: Character[] = [
  {
    name: "flask",
    mood: "wink",
    x: 0.5,
    size: 0.29,
    back: 0.34,
    pop: 1.02,
    poses: [
      ...hop(0.16, ripple),
      // The backflip.
      ...hop(1.3, { height: 1.05, air: 0.62, crouch: 0.16, squash: 0.7, spin: -360 }),
      ...hop(3.06, { ...ripple, from: -360 }),
      ...hop(4.1, { ...together, from: -360 }),
    ],
    gaze: [
      [0, -3, 0],
      [0.3, 0, 0],
      [0.5, 3, 0],
      [1.2, 0, -1],
      [2.2, 0, 0],
      [2.9, 3, 0],
      [3.3, -3, 0],
      [3.7, 0, 0],
      [4.1, 0, -2],
      [4.8, 0, 0],
    ],
    dust: [
      [2.08, 0.7],
      [4.68, 0.5],
    ],
  },
  {
    name: "cell",
    mood: "happy",
    x: 0.2,
    size: 0.34,
    back: 0,
    pop: 0.9,
    poses: [
      ...hop(0, ripple),
      ...hop(2.06, { height: 0.16, air: 0.2, crouch: 0.08 }),
      ...hop(3.22, ripple),
      ...hop(4.1, together),
    ],
    gaze: [
      [0, 1.5, 0],
      [0.5, 3, 0],
      [1.3, 3, -1],
      [1.7, 3.5, -2.5],
      [2.1, 3, 0],
      [2.9, 1.5, 0],
      [3.3, 0, 0],
      [4.1, 0, -2],
      [4.8, 0, 0],
    ],
    dust: [[4.68, 0.5]],
  },
  {
    name: "bolt",
    mood: "wow",
    x: 0.8,
    size: 0.34,
    back: 0,
    pop: 1.14,
    poses: [
      ...hop(0.32, ripple),
      ...hop(2.06, { height: 0.16, air: 0.2, crouch: 0.08 }),
      ...hop(2.9, ripple),
      ...hop(4.1, together),
    ],
    gaze: [
      [0, -3, 0],
      [0.6, 0, 0],
      [1.3, -3, -1],
      [1.7, -3.5, -2.5],
      [2.1, -3, 0],
      [2.6, 0, 0],
      [3.2, -3, 0],
      [3.7, 0, 0],
      [4.1, 0, -2],
      [4.8, 0, 0],
    ],
    dust: [[4.68, 0.5]],
  },
];

/** The poses as keyframes for one run of the loop, every track on one clock. */
function compile(poses: Pose[]) {
  const frames = [...poses].sort((a, b) => a.t - b.t);
  if (frames[0].t > 0) frames.unshift({ t: 0 });
  let spin = 0;
  const filled = frames.map((p) => {
    spin = p.spin ?? spin;
    return { ...p, spin };
  });
  if (filled[filled.length - 1].t < LOOP) filled.push({ t: LOOP, spin });
  return {
    times: filled.map((p) => p.t / LOOP),
    ease: filled.slice(0, -1).map((p) => p.ease ?? "easeInOut"),
    y: filled.map((p) => `${-(p.lift ?? 0) * 100}%`),
    scaleX: filled.map((p) => p.sx ?? 1),
    scaleY: filled.map((p) => p.sy ?? 1),
    rotate: filled.map((p) => p.spin),
    // The shadow shrinks as it rises.
    shadow: filled.map((p) => 1 - Math.min(p.lift ?? 0, 1.2) * 0.4),
  };
}

function compileGaze(gaze: Character["gaze"]) {
  const frames = [...gaze, [LOOP, gaze[0][1], gaze[0][2]] as [number, number, number]];
  return {
    times: frames.map(([t]) => t / LOOP),
    x: frames.map(([, x]) => `${x}px`),
    y: frames.map(([, , y]) => `${y}px`),
  };
}

const loop = (times: number[], ease?: Ease[]) => ({
  duration: LOOP,
  times,
  ease,
  delay: LOOP_START,
  repeat: Infinity,
});

// Popping up where it stands: stretching up out of nothing, a squash, settled.
const POP = { duration: 0.6, times: [0, 0.45, 0.65, 0.82, 1], ease: "easeOut" as const };

function Dust({ at, hard }: { at: number; hard: number }) {
  return (
    <motion.svg
      viewBox="0 0 60 20"
      className="pointer-events-none absolute top-[80%] left-[-5%] h-[22%] w-[110%] text-[color:var(--foreground)] motion-reduce:hidden"
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{ opacity: [0, 0.9, 0], scale: [0.3, 0.8 + hard * 0.2, 1.1 + hard * 0.5] }}
      transition={{
        duration: 0.45,
        times: [0, 0.25, 1],
        ease: "easeOut",
        delay: at,
        repeat: Infinity,
        repeatDelay: LOOP - 0.45,
      }}
    >
      <g fill="white" stroke="currentColor" strokeWidth={1.6}>
        <circle cx={10} cy={13} r={4.5} />
        <circle cx={18} cy={9} r={3} />
        <circle cx={50} cy={13} r={4.5} />
        <circle cx={42} cy={9} r={3} />
      </g>
    </motion.svg>
  );
}

function Doodle({ c }: { c: Character }) {
  const reduce = useReducedMotion();
  const track = compile(c.poses);
  const gaze = compileGaze(c.gaze);
  const popTransition = { ...POP, delay: c.pop };

  return (
    <div
      // Square, sunk by a tenth of its height: the drawings stand on the bottom
      // tenth of their box, so this puts their feet on the group's bottom edge,
      // or `back` of the way up it.
      className="absolute aspect-square translate-y-[10%]"
      style={{
        left: `${(c.x - c.size / 2) * 100}%`,
        bottom: `${c.back * 100}%`,
        width: `${c.size * 100}%`,
      }}
    >
      {/* Its shadow on the table: spreads as it pops up, shrinks as it jumps. */}
      <motion.div
        className="absolute top-[86%] left-[16%] h-[9%] w-[68%]"
        initial={{ opacity: 0, scaleX: 0 }}
        animate={{ opacity: [0, 1, 1, 1, 1], scaleX: [0, 1.1, 0.95, 1.02, 1] }}
        transition={popTransition}
      >
        <motion.div
          className="size-full rounded-[50%] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--foreground)_32%,transparent),transparent)]"
          animate={{ scaleX: track.shadow }}
          transition={loop(track.times, track.ease)}
        />
      </motion.div>

      <motion.div
        className="size-full origin-[50%_90%]"
        initial={{ opacity: 0, scaleX: 0, scaleY: 0 }}
        animate={{
          scaleX: [0, 0.9, 1.12, 0.97, 1],
          scaleY: [0, 1.2, 0.88, 1.03, 1],
          opacity: 1,
        }}
        transition={{ ...popTransition, opacity: { duration: 0.12, delay: c.pop } }}
      >
        <motion.div
          className="size-full origin-[50%_90%]"
          animate={{ y: track.y, scaleX: track.scaleX, scaleY: track.scaleY }}
          transition={loop(track.times, track.ease)}
        >
          <motion.div
            className="size-full"
            animate={{
              rotate: track.rotate,
              // The eyes, through the face's own --gaze-x/--gaze-y hook. Left
              // still with reduced motion.
              ...(!reduce && { "--gaze-x": gaze.x, "--gaze-y": gaze.y }),
            }}
            transition={{
              rotate: loop(track.times, track.ease),
              "--gaze-x": loop(gaze.times),
              "--gaze-y": loop(gaze.times),
            }}
          >
            <Mascot name={c.name} mood={c.mood} idle={false} className="size-full" />
          </motion.div>
        </motion.div>
      </motion.div>

      {c.dust.map(([at, hard]) => (
        <Dust key={at} at={LOOP_START + at} hard={hard} />
      ))}
    </div>
  );
}

export function BenchDoodles() {
  return (
    // Reduced motion: transforms jump straight to their resting keyframe, so
    // the cast stands still; the dust is hidden.
    <MotionConfig reducedMotion="user">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {CAST.map((c) => (
          <Doodle key={c.name} c={c} />
        ))}
      </div>
    </MotionConfig>
  );
}
