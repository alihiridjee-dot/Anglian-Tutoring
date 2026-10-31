/* The brick seam: a section rises into the one above it as a stepped row of
   blocks, a few of them loose, outlined in the same printed edge as the cards.

   It goes first inside the lower section, in place of that section's top
   padding and top rule. Only the gaps are painted (in `from`, the flat colour
   at the foot of the section above), so the blocks are the lower section's own
   background showing through — a gradient or a dot grid included. */

// Drawn by hand and repeated from the left edge, so a phone (about 15 columns)
// gets as much going on as a desktop. `#` is the section below.
const MOTIF = [
  "....#............#......",
  ".##...#...###..#.....#..",
  "###.###..##.#.###...####",
];
const GRID = MOTIF.map((row) => [...row.repeat(4)].map((ch) => ch === "#"));
const ROWS = GRID.length;
const COLS = GRID[0].length;

/** The gaps still showing the section above, and the edge between the two. */
function trace() {
  const below = (r: number, c: number) => (r < 0 ? false : r >= ROWS ? true : GRID[r][c]);
  let gaps = "";
  let edge = "";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; ) {
      if (GRID[r][c]) {
        c++;
        continue;
      }
      let run = 1;
      while (c + run < COLS && !GRID[r][c + run]) run++;
      gaps += `M${c} ${r}h${run}v1h${-run}z`;
      c += run;
    }
  }
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (below(r - 1, c) !== below(r, c)) edge += `M${c} ${r}h1`;
      if (r < ROWS && c > 0 && GRID[r][c - 1] !== GRID[r][c]) edge += `M${c} ${r}v1`;
    }
  }
  return { gaps, edge };
}
const PATHS = trace();

export function SectionSeam({ from, className = "" }: { from: string; className?: string }) {
  // Lifted a pixel over the section above: a section that starts on a half
  // pixel otherwise blends a hairline of its own background into the top of
  // the gaps. So the section must not clip its top (`overflow-x-clip` at most).
  return (
    <div
      aria-hidden
      className={`pointer-events-none relative -top-px flex overflow-hidden [--cell:1.5rem] sm:[--cell:2.25rem] lg:[--cell:3rem] ${className}`}
    >
      <svg
        viewBox={`0 0 ${COLS} ${ROWS}`}
        className="flex-none"
        style={{ width: `calc(var(--cell) * ${COLS})`, height: `calc(var(--cell) * ${ROWS})` }}
      >
        <path d={PATHS.gaps} fill={from} shapeRendering="crispEdges" />
        <path
          d={PATHS.edge}
          fill="none"
          stroke="color-mix(in oklab, var(--tint) 22%, var(--edge))"
          strokeWidth={1.5}
          strokeLinecap="square"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
