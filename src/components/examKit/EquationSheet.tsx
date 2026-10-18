import { Fragment, useState } from "react";
import { Search } from "lucide-react";
import { inputCls } from "@/components/tutor/Field";
import { cn } from "@/lib/utils";
import type { EquationSheet as Sheet } from "@/lib/examKit/equationSheets";
import { parseFormula, plainFormula, type FormulaNode } from "@/lib/examKit/formula";

/**
 * The physics equation sheet the student's paper comes with, in the paper's
 * order, with a box to find one by a word in it ("power", "density").
 */
export function EquationSheet({ sheet }: { sheet: Sheet }) {
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const shown = q
    ? sheet.equations.filter((e) =>
        `${plainFormula(e.word)} ${plainFormula(e.symbol)}`.toLowerCase().includes(q),
      )
    : sheet.equations;

  return (
    <div className="flex flex-col gap-3">
      {/* Pinned to the top of the panel, so it is there halfway down the list. */}
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
            placeholder="Find an equation"
            aria-label="Find an equation"
            className={`${inputCls} pl-9`}
          />
        </span>
      </label>

      <ol className="flex flex-col gap-2">
        {shown.map((e) => (
          <li
            key={e.word}
            className="rounded-xl border-[1.5px] border-[color:color-mix(in_oklab,var(--tint)_18%,var(--edge))] p-3"
          >
            <div className="flex items-start justify-between gap-2">
              {e.symbol ? (
                <Formula text={e.symbol} className="font-display text-lg font-bold" />
              ) : (
                <span />
              )}
              {e.only && <span className="chip shrink-0">{e.only}</span>}
            </div>
            <Formula text={e.word} className={cn("text-sm leading-snug", e.symbol && "mt-1.5")} />
          </li>
        ))}
      </ol>
      {shown.length === 0 && (
        <p className="text-sm font-semibold">No equation has “{find}” in it.</p>
      )}
    </div>
  );
}

/**
 * An equation drawn the way the sheet prints it: `{F|A}` is F over A, and
 * the rest of the notation in formula.ts (roots, powers, subscripts) is drawn
 * too. Anything it can't read is written as it stands.
 */
export function Formula({ text, className }: { text: string; className?: string }) {
  let nodes: FormulaNode[];
  try {
    nodes = parseFormula(text);
  } catch {
    nodes = [{ kind: "text", text }];
  }
  return <span className={cn("block", className)}>{draw(nodes)}</span>;
}

function draw(nodes: FormulaNode[]) {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return <Fragment key={i}>{n.text}</Fragment>;
      case "frac":
        return (
          <span
            key={i}
            className="mx-0.5 inline-flex flex-col items-center px-0.5 align-middle leading-tight"
          >
            <span className="px-1">{draw(n.top)}</span>
            <span className="w-full border-t-[1.5px] border-current px-1 text-center">
              {draw(n.bottom)}
            </span>
          </span>
        );
      case "root":
        return (
          <span key={i} className="inline-flex items-stretch align-middle">
            <span aria-hidden>√</span>
            <span className="border-t-[1.5px] border-current pl-0.5">{draw(n.body)}</span>
          </span>
        );
      case "sup":
        return (
          <sup key={i} className="text-[0.7em]">
            {draw(n.body)}
          </sup>
        );
      case "sub":
        return (
          <sub key={i} className="text-[0.7em]">
            {draw(n.body)}
          </sub>
        );
      case "bar":
        return (
          <span key={i} className="overline">
            {draw(n.body)}
          </span>
        );
      case "bold":
        return (
          <strong key={i} className="font-extrabold">
            {draw(n.body)}
          </strong>
        );
    }
  });
}
