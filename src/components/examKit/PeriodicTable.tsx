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
        <GroupLabels sheet={sheet} size="text-[0.6rem]" small="text-[0.45rem]" />
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
              {c.starred && mark(sheet, c.element.z)}
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
        {hasRows(sheet) && <span style={{ gridRow: 9, gridColumn: 1 }} className="h-1" />}
        <RowLabels sheet={sheet} className="text-[0.45rem]" />
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

const hasRows = (sheet: PeriodicSheet) => sheet.fBlock === "rows" || sheet.fBlock === "starredRows";
const mark = (sheet: PeriodicSheet, z: number) => sheet.marks?.[z] ?? "*";

/**
 * The group numbers as the sheet prints them: over the main-group columns
 * (two ways, where the sheet numbers them both ways), and over groups 3–12
 * above the transition metals where the sheet numbers those too.
 */
function GroupLabels({
  sheet,
  size,
  small,
}: {
  sheet: PeriodicSheet;
  size: string;
  small: string;
}) {
  return (
    <>
      {LABELLED.map((g, i) => (
        <span
          key={`g${g}`}
          style={{ gridRow: 1, gridColumn: g }}
          className={cn(
            "font-display flex flex-col items-center justify-end text-center leading-tight font-extrabold text-[color:var(--tint)]",
            size,
          )}
        >
          {sheet.groups[i]}
          {sheet.subGroups && <span className={cn("font-bold", small)}>{sheet.subGroups[i]}</span>}
        </span>
      ))}
      {sheet.transitionGroups?.map((label, i) => (
        <span
          key={`t${label}`}
          // Period 3's row is empty over the transition metals: the labels sit there.
          style={{ gridRow: 4, gridColumn: i + 3 }}
          className={cn(
            "font-display self-end text-center leading-tight font-bold text-[color:var(--tint)]",
            small,
          )}
        >
          {label}
        </span>
      ))}
    </>
  );
}

/** The names some sheets print beside the two rows underneath the table. */
function RowLabels({ sheet, className }: { sheet: PeriodicSheet; className: string }) {
  if (!sheet.fRowLabels) return null;
  // The rows start in group 4 when La and Ac stay in the table, else group 3.
  const span = sheet.fBlock === "starredRows" ? "1 / 4" : "1 / 3";
  return (
    <>
      {sheet.fRowLabels.map((label, i) => (
        <span
          key={label}
          style={{ gridRow: 10 + i, gridColumn: span }}
          className={cn("flex items-center pr-1 leading-tight font-bold", className)}
        >
          {label}
        </span>
      ))}
    </>
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
            <GroupLabels sheet={sheet} size="text-sm" small="text-xs" />
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
                      {c.starred && mark(sheet, c.element.z)}
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
            {hasRows(sheet) && <span style={{ gridRow: 9, gridColumn: 1 }} className="h-2" />}
            <RowLabels sheet={sheet} className="text-sm" />
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
