import { useState } from "react";
import { Search } from "lucide-react";
import { inputCls } from "@/components/tutor/Field";
import { Formula } from "@/components/examKit/EquationSheet";
import { plainFormula } from "@/lib/examKit/formula";
import type { BookletBlock, DataBooklet as Booklet, ShiftBand } from "@/lib/examKit/dataBooklets";

const EDGE = "border-[color:color-mix(in_oklab,var(--tint)_18%,var(--edge))]";

/**
 * The board's A-level data booklet, block by block in the booklet's order:
 * constants and tables, formulae under the booklet's own headings, and the
 * NMR charts drawn as shift ranges along the axis. A box finds a formula or a
 * value by a word in it ("capacitance", "Planck", "C=O").
 */
export function DataBooklet({ booklet }: { booklet: Booklet }) {
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const blocks = q ? booklet.blocks.flatMap((b) => match(b, q)) : booklet.blocks;

  return (
    <div className="flex flex-col gap-3">
      {/* Pinned to the top of the panel, so it is there halfway down the booklet. */}
      <label className="bg-card sticky -top-4 z-10 block py-1">
        <span className="relative block">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find a formula or value"
            aria-label="Find a formula or value"
            className={`${inputCls} pl-9`}
          />
        </span>
      </label>

      {blocks.map((b, i) => (
        <section key={`${b.title}-${i}`} className={`rounded-xl border-[1.5px] ${EDGE} p-3`}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base leading-snug">
              <Formula text={b.title} />
            </h3>
            {b.only && <span className="chip shrink-0">{b.only}</span>}
          </div>
          <div className="mt-2">
            {b.kind === "formulae" ? (
              <Formulae block={b} />
            ) : b.kind === "table" ? (
              <Table block={b} />
            ) : (
              <Shifts block={b} />
            )}
          </div>
          {b.notes?.map((n) => (
            <Formula key={n} text={n} className="mt-2 text-sm leading-snug font-semibold" />
          ))}
        </section>
      ))}
      {blocks.length === 0 && (
        <p className="text-sm font-semibold">Nothing in the booklet has “{find}” in it.</p>
      )}
    </div>
  );
}

/** The block cut down to what matches, or nothing; a block whose title matches keeps it all. */
function match(b: BookletBlock, q: string): BookletBlock[] {
  const has = (s: string) => plainFormula(s).toLowerCase().includes(q);
  if (has(b.title)) return [b];
  if (b.kind === "formulae") {
    const rows = b.rows.filter((r) => has(r.label) || r.formulae.some(has));
    return rows.length ? [{ ...b, rows }] : [];
  }
  if (b.kind === "table") {
    const rows = b.rows.filter((r) => r.some(has));
    return rows.length ? [{ ...b, rows }] : [];
  }
  const bands = b.bands.filter((s) => has(s.label));
  return bands.length ? [{ ...b, bands }] : [];
}

function Formulae({ block }: { block: Extract<BookletBlock, { kind: "formulae" }> }) {
  return (
    <dl className="flex flex-col gap-2.5">
      {block.rows.map((r, i) => (
        <div key={`${r.label}-${i}`}>
          {r.label && (
            <dt className="text-sm leading-snug font-bold text-[color:var(--tint)]">
              <Formula text={r.label} />
            </dt>
          )}
          <dd className="mt-0.5 flex flex-wrap items-center gap-x-5 gap-y-1">
            {r.formulae.map((f, j) => (
              <Formula key={`${f}-${j}`} text={f} className="font-display text-base font-bold" />
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ block }: { block: Extract<BookletBlock, { kind: "table" }> }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full border-collapse text-left text-sm leading-snug">
        {block.head && (
          <thead>
            <tr>
              {block.head.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`border-b-[1.5px] ${EDGE} px-1.5 py-1 align-bottom font-display font-extrabold`}
                >
                  <Formula text={h} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className={`border-b ${EDGE} last:border-b-0`}>
              {row.map((cell, j) => (
                <td key={j} className="px-1.5 py-1 align-top">
                  <Formula text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * An NMR chart: each range the booklet draws, as a bar along the same axis,
 * so a shift can be read off against it as on the paper.
 */
function Shifts({ block }: { block: Extract<BookletBlock, { kind: "shifts" }> }) {
  const { from, to, step, unit } = block.axis;
  const span = from - to;
  const at = (v: number) => `${((from - v) / span) * 100}%`;
  const ticks: number[] = [];
  for (let v = from; from > to ? v >= to - 1e-9 : v <= to + 1e-9; v += from > to ? -step : step)
    ticks.push(Math.round(v * 100) / 100);

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {block.bands.map((s: ShiftBand, i) => (
          <li key={`${s.label}-${i}`}>
            <div className="flex items-baseline justify-between gap-2 text-sm leading-snug">
              <Formula text={s.label} className="font-semibold" />
              <span className="numeral shrink-0 text-xs">
                {s.high === s.low ? s.high : `${s.low}–${s.high}`}
              </span>
            </div>
            <div className="relative mt-1 h-2 rounded-full bg-[color:color-mix(in_oklab,var(--tint)_10%,var(--card))]">
              <span
                className="absolute inset-y-0 min-w-1.5 rounded-full bg-[color:var(--tint)]"
                style={{ left: at(s.high), width: `${((s.high - s.low) / span) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="relative mt-1 h-4" aria-hidden>
        {ticks.map((t) => (
          <span
            key={t}
            className="numeral absolute -translate-x-1/2 text-[0.6rem]"
            style={{ left: at(t) }}
          >
            {t}
          </span>
        ))}
      </div>
      <Formula text={unit} className="text-center text-xs font-bold" />
    </div>
  );
}
