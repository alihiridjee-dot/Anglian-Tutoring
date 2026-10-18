import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";
import {
  sheetCells,
  type Element,
  type PeriodicSheet,
  type SheetCell,
} from "@/lib/examKit/periodicTable";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { cn } from "@/lib/utils";

/** The main-group columns the sheet labels (groups 1, 2, 13–18). */
const LABELLED = [1, 2, 13, 14, 15, 16, 17, 18];

/**
 * The board's periodic table, small enough for the side panel: tap an element
 * to read its mass. "Full size" opens it as the paper prints it, every mass
 * showing.
 */
export function PeriodicTable({ sheet }: { sheet: PeriodicSheet }) {
  const [picked, setPicked] = useState<Element | null>(null);
  const [full, setFull] = useState(false);
  const cells = sheetCells(sheet);

  return (
    <div className="flex flex-col gap-3">
      <ElementCard sheet={sheet} element={picked} />

      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))" }}
        role="group"
        aria-label={`${sheet.label} periodic table`}
      >
        {LABELLED.map((g, i) => (
          <span
            key={`g${g}`}
            style={{ gridRow: 1, gridColumn: g }}
            className="font-display text-center text-[0.6rem] font-extrabold text-[color:var(--tint)]"
          >
            {sheet.groups[i]}
          </span>
        ))}
        {cells.map((c) =>
          c.element ? (
            <button
              key={c.key}
              type="button"
              onClick={() => setPicked(c.element!)}
              aria-pressed={picked?.z === c.element.z}
              aria-label={[c.element.name, sheet.masses[c.element.z]].filter(Boolean).join(", ")}
              style={{ gridRow: c.row, gridColumn: c.col }}
              className={cn(
                "font-display flex aspect-square cursor-pointer items-center justify-center rounded-[3px] text-[0.55rem] leading-none font-bold transition sm:text-[0.6rem]",
                picked?.z === c.element.z
                  ? "bg-[color:var(--tint)] text-white"
                  : "bg-[color:color-mix(in_oklab,var(--tint)_10%,var(--card))] hover:bg-[color:color-mix(in_oklab,var(--tint)_24%,var(--card))]",
              )}
            >
              {c.element.symbol}
              {c.starred && "*"}
            </button>
          ) : (
            <span
              key={c.key}
              style={{ gridRow: c.row, gridColumn: c.col }}
              className="flex aspect-square items-center justify-center rounded-[3px] border border-dashed border-[color:color-mix(in_oklab,var(--tint)_30%,transparent)] text-[0.4rem] leading-none font-bold"
              aria-hidden
            >
              {c.placeholder?.range}
            </span>
          ),
        )}
        {/* A gap row between the main table and the f-block, as printed. */}
        {sheet.fBlock === "rows" && <span style={{ gridRow: 9, gridColumn: 1 }} className="h-1" />}
      </div>

      {sheet.dataNotes.map((n) => (
        <p key={n} className="text-sm font-semibold">
          {n}
        </p>
      ))}

      <button
        type="button"
        onClick={() => setFull(true)}
        className="btn-soft inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm sm:pointer-fine:min-h-9"
      >
        <Maximize2 className="size-4" aria-hidden />
        Full size
      </button>

      {full && <FullTable sheet={sheet} cells={cells} onClose={() => setFull(false)} />}
    </div>
  );
}

/**
 * The picked element, or the sheet's key before one is picked — the same box
 * the paper prints, in the same order.
 */
function ElementCard({ sheet, element }: { sheet: PeriodicSheet; element: Element | null }) {
  const mass = element ? sheet.masses[element.z] : null;
  return (
    <div className="flex items-center gap-3 rounded-xl border-[1.5px] border-[color:color-mix(in_oklab,var(--tint)_24%,var(--edge))] bg-[color:color-mix(in_oklab,var(--tint)_5%,var(--card))] p-3">
      <span className="icon-tile font-display size-14 shrink-0 text-2xl font-extrabold">
        {element ? element.symbol : "X"}
      </span>
      {element ? (
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight font-extrabold capitalize">
            {element.name}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="chip">
              Atomic number <span className="numeral">{element.z}</span>
            </span>
            {mass && (
              <span className="chip">
                Relative atomic mass <span className="numeral">{mass}</span>
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="min-w-0 text-sm leading-snug font-semibold">
          {sheet.massFirst ? (
            <>
              <p>relative atomic mass</p>
              <p className="font-display font-extrabold">atomic symbol</p>
              <p>atomic (proton) number</p>
            </>
          ) : (
            <>
              <p>atomic number</p>
              <p className="font-display font-extrabold">atomic symbol</p>
              <p>relative atomic mass</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The whole table as the paper prints it, every cell showing its numbers. */
function FullTable({
  sheet,
  cells,
  onClose,
}: {
  sheet: PeriodicSheet;
  cells: SheetCell[];
  onClose: () => void;
}) {
  useBodyScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="bg-primary-deep/50 fixed inset-0 z-[60] flex items-center justify-center p-4 short:p-2"
      role="dialog"
      aria-modal="true"
      aria-labelledby="periodic-full-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="premium-card flex max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden shadow-xl">
        <div className="border-border flex shrink-0 items-center justify-between gap-3 border-b p-4 short:p-2">
          <h2 id="periodic-full-title" className="font-display text-lg font-extrabold">
            {sheet.label} periodic table
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl sm:pointer-fine:size-9"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-auto p-4 short:p-2">
          <div
            className="grid min-w-[52rem] gap-[3px]"
            style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))" }}
          >
            {LABELLED.map((g, i) => (
              <span
                key={`g${g}`}
                style={{ gridRow: 1, gridColumn: g }}
                className="font-display text-center text-sm font-extrabold text-[color:var(--tint)]"
              >
                {sheet.groups[i]}
              </span>
            ))}
            {cells.map((c) => (
              <div
                key={c.key}
                style={{ gridRow: c.row, gridColumn: c.col }}
                className={cn(
                  "flex flex-col items-center justify-center rounded-md px-0.5 py-1 text-center leading-tight",
                  c.element
                    ? "bg-[color:color-mix(in_oklab,var(--tint)_8%,var(--card))] border border-[color:color-mix(in_oklab,var(--tint)_20%,transparent)]"
                    : "border border-dashed border-[color:color-mix(in_oklab,var(--tint)_30%,transparent)]",
                )}
              >
                {c.element ? (
                  <>
                    <span className="numeral text-[0.7rem]">
                      {sheet.massFirst ? sheet.masses[c.element.z] : c.element.z}
                    </span>
                    <span className="font-display text-base font-extrabold">
                      {c.element.symbol}
                      {c.starred && "*"}
                    </span>
                    <span className="text-[0.55rem] font-semibold">{c.element.name}</span>
                    <span className="numeral text-[0.7rem]">
                      {sheet.massFirst ? c.element.z : sheet.masses[c.element.z]}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="numeral text-[0.7rem]">{c.placeholder?.range}</span>
                    <span className="text-[0.55rem] font-semibold">{c.placeholder?.name}</span>
                  </>
                )}
              </div>
            ))}
            {sheet.fBlock === "rows" && (
              <span style={{ gridRow: 9, gridColumn: 1 }} className="h-2" />
            )}
          </div>
          {sheet.notes.length > 0 && (
            <div className="mt-4 space-y-1 text-sm font-semibold">
              {sheet.notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
