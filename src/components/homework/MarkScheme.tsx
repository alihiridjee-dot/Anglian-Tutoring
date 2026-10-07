import { useMemo, type ReactNode } from "react";
import { SciText } from "@/components/Shared";
import {
  layoutMarkScheme,
  type MarkSchemeItem,
  type MarkSchemeRow,
} from "@/lib/homework/markSchemeLayout";
import { cn } from "@/lib/utils";

type Point = Extract<MarkSchemeRow, { kind: "point" }>;

/** A level of response: its bullets start a list of their own. */
const isLevel = (p: Point) => /^(?:Level\s*\d|0\s+marks?)/i.test(p.label ?? "");

/**
 * A mark scheme, however it was written, drawn as a mark scheme reads: parts
 * and section names in bold, each marking point a bullet, guidance on its own
 * lines. `layoutMarkScheme` finds the structure. Size and colour come from the
 * parent, so the student's sheet and the tutor's marking card keep their own.
 */
export function MarkScheme({
  scheme,
  context,
  className,
}: {
  scheme: string;
  /** Text shown alongside, so its notation reads alike (see `SciText`). */
  context?: string;
  className?: string;
}) {
  const rows = useMemo(() => layoutMarkScheme(scheme), [scheme]);

  // Points next to each other share one list, until a level starts its own.
  const groups: (MarkSchemeRow | Point[])[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (row.kind === "point" && Array.isArray(last) && isLevel(last[0]) === isLevel(row)) {
      last.push(row);
    } else groups.push(row.kind === "point" ? [row] : row);
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {groups.map((group, i) =>
        Array.isArray(group) ? (
          <Bullets key={i}>
            {group.map((p, j) => (
              <li key={j}>
                <Labelled label={p.label} text={p.text} context={context} />
                {p.items.length > 0 && <Items items={p.items} context={context} nested />}
                {p.notes.map((note, k) => (
                  <span key={k} className="mt-0.5 block italic">
                    <SciText text={note} context={context} />
                  </span>
                ))}
              </li>
            ))}
          </Bullets>
        ) : (
          <div key={i}>
            <p>
              <Labelled label={group.label} text={group.text} context={context} />
            </p>
            {group.items.length > 0 && <Items items={group.items} context={context} />}
          </div>
        ),
      )}
    </div>
  );
}

function Bullets({ nested, children }: { nested?: boolean; children: ReactNode }) {
  return (
    <ul
      className={cn(
        "space-y-1 pl-5 marker:text-[color:var(--tint)]",
        nested ? "mt-1 list-[circle]" : "list-disc",
      )}
    >
      {children}
    </ul>
  );
}

function Items({
  items,
  context,
  nested,
}: {
  items: MarkSchemeItem[];
  context?: string;
  nested?: boolean;
}) {
  return (
    <Bullets nested={nested}>
      {items.map((item, k) => (
        <li key={k}>
          <Labelled label={item.label} text={item.text} context={context} />
        </li>
      ))}
    </Bullets>
  );
}

function Labelled({
  label,
  text,
  context,
}: {
  label: string | null;
  text: string;
  context?: string;
}) {
  return (
    <>
      {label && (
        <span className="font-bold">
          <SciText text={label} context={context} />
        </span>
      )}
      {label && text && " "}
      {text && <SciText text={text} context={context} />}
    </>
  );
}
