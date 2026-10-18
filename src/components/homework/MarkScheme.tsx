import { useMemo, type ReactNode } from "react";
import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Check,
  CornerDownRight,
  Lightbulb,
  ListChecks,
  X,
  type LucideIcon,
} from "lucide-react";
import { SciText } from "@/components/Shared";
import {
  isLevelRow,
  keyTermRuns,
  layoutMarkScheme,
  sectionMarkScheme,
  type MarkSchemeItem,
  type MarkSchemeRow,
  type MarkSchemeSection,
} from "@/lib/homework/markSchemeLayout";
import { cn } from "@/lib/utils";

type Point = Extract<MarkSchemeRow, { kind: "point" }>;

/** Guidance that takes credit away, drawn with a cross rather than an arrow. */
const REJECTS = /^\(?(?:do not|don['’]t|reject|ignore|no (?:marks?|credit)|not\b|penalise)/i;

const SECTION: Record<
  MarkSchemeSection["kind"],
  { title: (marks?: number) => string; icon: LucideIcon; tint?: string }
> = {
  points: { title: () => "What earns marks", icon: ListChecks },
  levels: {
    title: (marks) => (marks ? `How the ${marks} marks are given` : "How the marks are given"),
    icon: ChartNoAxesColumnIncreasing,
    tint: "tint-primary",
  },
  guidance: { title: () => "Examiner tips", icon: Lightbulb, tint: "tint-amber" },
};

/**
 * A mark scheme, however it was written, signposted for a student: what earns
 * marks (each point ticked), how the levels give them (a ladder of marks), and
 * the examiner's tips (→ accepted, ✗ not credited). Key terms the generator
 * wrapped in **…** are drawn with the highlighter. `layoutMarkScheme` finds
 * the structure and `sectionMarkScheme` the sections. Size and colour come
 * from the parent; `compact` (the tutor's marking card) drops the icon tiles.
 */
export function MarkScheme({
  scheme,
  context,
  marks,
  compact,
  className,
}: {
  scheme: string;
  /** Text shown alongside, so its notation reads alike (see `SciText`). */
  context?: string;
  /** The question's marks, named in the levels heading. */
  marks?: number;
  compact?: boolean;
  className?: string;
}) {
  const sections = useMemo(() => sectionMarkScheme(layoutMarkScheme(scheme)), [scheme]);
  // One list of points needs no heading: the "Mark scheme" label above says it.
  const headed = sections.length > 1 || sections[0]?.kind !== "points";

  return (
    <div className={cn(compact ? "space-y-2" : "space-y-4", className)}>
      {sections.map((section, i) => {
        const { title, icon: Icon, tint } = SECTION[section.kind];
        return (
          <section key={i} className={tint}>
            {headed && (
              <div className={cn("flex items-center", compact ? "mb-1" : "mb-2 gap-2.5")}>
                {!compact && (
                  <span className="icon-tile size-8 shrink-0" aria-hidden>
                    <Icon className="size-4" />
                  </span>
                )}
                <h4 className={cn("font-extrabold", compact ? "text-xs" : "text-base")}>
                  {title(marks)}
                  {section.part ? ` for ${section.part}` : ""}
                </h4>
              </div>
            )}
            <Rows section={section} context={context} />
          </section>
        );
      })}
    </div>
  );
}

function Rows({ section, context }: { section: MarkSchemeSection; context?: string }) {
  // Points next to each other share one list.
  const groups: (MarkSchemeRow | Point[])[] = [];
  for (const row of section.rows) {
    const last = groups[groups.length - 1];
    if (row.kind === "point" && Array.isArray(last)) last.push(row);
    else groups.push(row.kind === "point" ? [row] : row);
  }
  const guidance = section.kind === "guidance";

  return (
    <div className="space-y-1.5">
      {groups.map((group, i) =>
        Array.isArray(group) ? (
          <ul key={i} className="space-y-1.5">
            {group.map((p, j) =>
              isLevelRow(p) ? (
                <LevelRow key={j} point={p} top={j === 0} context={context} />
              ) : (
                <IconRow
                  key={j}
                  {...guidanceIcon(guidance, p.text || p.label || "")}
                  body={<PointBody point={p} context={context} />}
                />
              ),
            )}
          </ul>
        ) : guidance && !group.items.length ? (
          <ul key={i}>
            <IconRow
              {...guidanceIcon(true, group.text || group.label || "")}
              body={<Labelled label={group.label} text={group.text} context={context} />}
            />
          </ul>
        ) : (
          <div key={i}>
            <p>
              <Labelled label={group.label} text={group.text} context={context} />
            </p>
            {/* "Any three from:" introduces points: they read as points. */}
            {group.items.length > 0 && (
              <ul className="mt-1.5 space-y-1.5">
                {group.items.map((item, k) => (
                  <IconRow
                    key={k}
                    {...guidanceIcon(guidance, item.text || item.label || "")}
                    body={<Labelled label={item.label} text={item.text} context={context} />}
                  />
                ))}
              </ul>
            )}
          </div>
        ),
      )}
    </div>
  );
}

/** A point earns a tick; a tip points on, or crosses out what isn't credited. */
function guidanceIcon(guidance: boolean, text: string): { icon: LucideIcon; tint?: string } {
  if (!guidance) return { icon: Check };
  return REJECTS.test(text)
    ? { icon: X, tint: "tint-rose" }
    : { icon: ArrowRight, tint: "tint-emerald" };
}

function IconRow({ icon: Icon, tint, body }: { icon: LucideIcon; tint?: string; body: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className={cn("mt-[0.2em] shrink-0", tint)} aria-hidden>
        <Icon className="size-[1.1em] text-[color:var(--tint)]" strokeWidth={2.75} />
      </span>
      <div className="min-w-0 flex-1">{body}</div>
    </li>
  );
}

/** "Level 3 (5–6 marks):" as a marks chip, then "Level 3" in bold; "0 marks:" as the chip alone. */
function LevelRow({ point, top, context }: { point: Point; top: boolean; context?: string }) {
  const label = (point.label ?? "").trim().replace(/\s*:$/, "");
  const level = /^(Level\s*\d+)\s*(?:\(([^()]*)\))?$/i.exec(label);
  const chip = level ? (level[2] ?? level[1]) : label;
  const name = level?.[2] ? level[1] : null;
  return (
    <li className="flex flex-col items-start gap-1 sm:flex-row sm:gap-2.5">
      {/* One width, so every level's words start in line; on a phone the chip
          sits above them, which keeps the words the card's full width. */}
      <span className={cn("chip min-w-[5.5rem] shrink-0 justify-center", top && "chip-solid")}>
        {chip}
      </span>
      <div className="min-w-0 flex-1">
        <PointBody point={{ ...point, label: name }} context={context} />
      </div>
    </li>
  );
}

function PointBody({ point, context }: { point: Point; context?: string }) {
  return (
    <>
      <Labelled label={point.label} text={point.text} context={context} />
      {point.items.length > 0 && <Items items={point.items} context={context} />}
      {point.notes.map((note, k) => (
        <span key={k} className="mt-0.5 flex gap-1.5 italic">
          <CornerDownRight
            className="mt-[0.2em] size-[1em] shrink-0 text-[color:var(--tint)]"
            aria-hidden
          />
          <span>
            <Marked text={note} context={context} />
          </span>
        </span>
      ))}
    </>
  );
}

function Items({ items, context }: { items: MarkSchemeItem[]; context?: string }) {
  return (
    <ul className="mt-1 list-[circle] space-y-1 pl-5 marker:text-[color:var(--tint)]">
      {items.map((item, k) => (
        <li key={k}>
          <Labelled label={item.label} text={item.text} context={context} />
        </li>
      ))}
    </ul>
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
          <Marked text={label} context={context} />
        </span>
      )}
      {label && text && " "}
      {text && <Marked text={text} context={context} />}
    </>
  );
}

/** Text with its **key terms** under the highlighter. */
function Marked({ text, context }: { text: string; context?: string }) {
  return (
    <>
      {keyTermRuns(text).map((r, i) =>
        r.key ? (
          <mark key={i} className="marker bg-transparent text-inherit">
            <SciText text={r.text} context={context} />
          </mark>
        ) : (
          <SciText key={i} text={r.text} context={context} />
        ),
      )}
    </>
  );
}
