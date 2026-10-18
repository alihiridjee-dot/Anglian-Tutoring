import { Fragment, useState } from "react";
import { Search } from "lucide-react";
import { inputCls } from "@/components/tutor/Field";
import { cn } from "@/lib/utils";
import type { EquationSheet as Sheet } from "@/lib/examKit/equationSheets";

/**
 * The physics equation sheet the student's paper comes with, in the paper's
 * order, with a box to find one by a word in it ("power", "density").
 */
export function EquationSheet({ sheet }: { sheet: Sheet }) {
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const shown = q
    ? sheet.equations.filter((e) =>
        `${e.word} ${e.symbol}`.replace(/[{}|]/g, " ").toLowerCase().includes(q),
      )
    : sheet.equations;

  return (
    <div className="flex flex-col gap-3">
      <label className="relative block">
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
 * A symbol equation with its fractions stacked, as the sheet prints them.
 * `{F|A}` is F over A; everything else is written as it stands.
 */
export function Formula({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\{[^{}|]+\|[^{}]+\})/);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1", className)}>
      {parts.map((p, i) => {
        const frac = /^\{([^{}|]+)\|([^{}]+)\}$/.exec(p);
        if (!frac) return p ? <Fragment key={i}>{p}</Fragment> : null;
        return (
          <span key={i} className="inline-flex flex-col items-center px-0.5 leading-tight">
            <span className="px-1">{frac[1]}</span>
            <span className="w-full border-t-[1.5px] border-current px-1">{frac[2]}</span>
          </span>
        );
      })}
    </span>
  );
}
