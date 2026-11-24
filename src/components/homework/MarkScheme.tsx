import { useMemo, useState, type ReactNode } from "react";
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
import { StopTrail } from "@/components/chat/ContextPicker";
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
/** Guidance that allows another answer, drawn with a tick. */
const ACCEPTS = /^\(?(?:accept|allow|credit|award|also accept)/i;

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
 * marks (each point ticked), how the levels give them, and the examiner's tips
 * (✓ also accepted, ✗ not credited). Key terms the generator wrapped in **…**
 * are drawn with the highlighter. `layoutMarkScheme` finds the structure and
 * `sectionMarkScheme` the sections.
 *
 * On a student's sheet the parts are stops on a trail (✅ Earns marks, 🪜 the
 * marks, 💡 Tips) with one panel open underneath, and the levels are a row of
 * dots from 0 up, a 📍 on the one the answer reached. `compact` (the tutor's
 * marking card) keeps every part on show under small headings instead.
 */
export function MarkScheme({
  scheme,
  context,
  marks,
  level,
  compact,
  className,
}: {
  scheme: string;
  /** Text shown alongside, so its notation reads alike (see `SciText`). */
  context?: string;
  /** The question's marks, named in the levels heading. */
  marks?: number;
  /** The level the student's answer reached ("2"), when it was marked as a whole. */
  level?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const sections = useMemo(() => sectionMarkScheme(layoutMarkScheme(scheme)), [scheme]);
  if (!compact)
    return (
      <SchemeTrail
        sections={sections}
        marks={marks}
        level={level}
        context={context}
        className={className}
      />
    );
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

const STOPS: {
  kind: MarkSchemeSection["kind"];
  label: (marks?: number) => string;
  glyph: string;
}[] = [
  { kind: "points", label: () => "Earns marks", glyph: "✅" },
  { kind: "levels", label: (marks) => (marks ? `The ${marks} marks` : "Levels"), glyph: "🪜" },
  { kind: "guidance", label: () => "Tips", glyph: "💡" },
];

/**
 * The scheme as a trail: a stop for each kind of part it has, and the picked
 * stop's parts in one panel. It opens on the levels when the answer reached
 * one, otherwise on the first stop. A scheme of one kind needs no trail.
 */
function SchemeTrail({
  sections,
  marks,
  level,
  context,
  className,
}: {
  sections: MarkSchemeSection[];
  marks?: number;
  level?: string | null;
  context?: string;
  className?: string;
}) {
  const stops = STOPS.filter((s) => sections.some((section) => section.kind === s.kind));
  const [picked, setPicked] = useState<MarkSchemeSection["kind"] | null>(null);
  const opening = level != null && stops.some((s) => s.kind === "levels") ? "levels" : null;
  const shown = stops.find((s) => s.kind === picked)?.kind ?? opening ?? stops[0]?.kind ?? "points";
  const body = sections
    .filter((s) => s.kind === shown)
    .map((s, i) => <SectionBody key={i} section={s} level={level} context={context} />);

  if (stops.length < 2) return <div className={cn("space-y-4", className)}>{body}</div>;
  return (
    <div className={className}>
      <StopTrail
        label="Mark scheme"
        stops={stops.map((s) => ({ key: s.kind, label: s.label(marks), glyph: s.glyph }))}
        picked={shown}
        onPick={setPicked}
      />
      <div key={shown} className="point-panel scheme-panel space-y-4">
        {body}
      </div>
    </div>
  );
}

/** One part in the panel: its rows, or for the levels, the dots and the rest. */
function SectionBody({
  section,
  level,
  context,
}: {
  section: MarkSchemeSection;
  level?: string | null;
  context?: string;
}) {
  const heading = section.part && <h5 className="mb-2 font-extrabold">For {section.part}</h5>;
  if (section.kind !== "levels")
    return (
      <div>
        {heading}
        <Rows section={section} context={context} />
      </div>
    );
  // Levels next to each other share one row of dots; any other line reads as rows.
  const runs: { levels: boolean; rows: MarkSchemeRow[] }[] = [];
  for (const row of section.rows) {
    const isLevel = isLevelRow(row);
    const last = runs[runs.length - 1];
    if (last?.levels === isLevel) last.rows.push(row);
    else runs.push({ levels: isLevel, rows: [row] });
  }
  return (
    <div className="space-y-3">
      {heading}
      {runs.map((run, i) =>
        run.levels ? (
          <LevelSteps key={i} rows={run.rows as Point[]} level={level} context={context} />
        ) : (
          <Rows key={i} section={{ ...section, rows: run.rows }} context={context} />
        ),
      )}
    </div>
  );
}

/** "Level 3 (5–6 marks)" or "0 marks", with nothing more in it. */
const PLAIN_LEVEL =
  /^(?:Level\s*\d+\s*(?:\(\s*\d+(?:\s*[–-]\s*\d+)?\s*marks?\s*\))?|\d+(?:\s*[–-]\s*\d+)?\s*marks?)$/i;

/** A level as a dot: its marks ("5–6"), or "L3" when it names none. */
function stepOf(point: Point, i: number) {
  const label = (point.label ?? "").trim().replace(/\s*:$/, "");
  const number = /^Level\s*(\d+)/i.exec(label)?.[1] ?? null;
  const range = /(\d+(?:\s*[–-]\s*\d+)?)\s*marks?\b/i.exec(label)?.[1].replace(/\s+/g, "") ?? null;
  const name = PLAIN_LEVEL.test(label) ? (number ? `Level ${number}` : null) : label;
  const top = Math.max(...(range ?? number ?? "0").split(/[–-]/).map(Number));
  return { key: point.label ?? String(i), number, range, name, top, point };
}

/**
 * The levels as a row of dots from no marks up, on a dotted line. The picked
 * level's words sit under them; it starts on the student's level (marked 📍),
 * or on the top one.
 */
function LevelSteps({
  rows,
  level,
  context,
}: {
  rows: Point[];
  level?: string | null;
  context?: string;
}) {
  const steps = rows.map(stepOf).sort((a, b) => a.top - b.top);
  const yours = level != null ? steps.find((s) => s.number === level) : undefined;
  const [picked, setPicked] = useState<string | null>(null);
  const open = steps.find((s) => s.key === picked) ?? yours ?? steps[steps.length - 1];
  return (
    <div>
      <div role="group" aria-label="Levels" className="scheme-steps">
        {steps.map((s) => (
          <button
            key={s.key}
            type="button"
            className="scheme-step"
            aria-pressed={s === open}
            aria-label={[s.name, s.range && `${s.range} marks`, s === yours && "your answer"]
              .filter(Boolean)
              .join(", ")}
            onClick={() => setPicked(s.key)}
          >
            <span aria-hidden className="scheme-step-dot numeral">
              {s.range ?? (s.number ? `L${s.number}` : "0")}
              {s === yours && <span className="scheme-pin">📍</span>}
            </span>
          </button>
        ))}
      </div>
      <div key={open.key} className="scheme-step-words">
        <PointBody point={{ ...open.point, label: open.name }} context={context} />
      </div>
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
                  {...guidanceIcon(guidance, said(p))}
                  body={<PointBody point={p} context={context} />}
                />
              ),
            )}
          </ul>
        ) : guidance && !group.items.length ? (
          <ul key={i}>
            <IconRow
              {...guidanceIcon(true, said(group))}
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
                    {...guidanceIcon(guidance, said(item))}
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

/** A row's words as a reader meets them: "Accept relative ordering: alpha…". */
const said = (row: { label: string | null; text: string }) =>
  `${row.label ?? ""} ${row.text}`.trim();

/**
 * A point earns a tick. A tip sits in a solid dot: a tick for another answer
 * that is accepted, a cross for one that isn't, an arrow for anything else.
 */
function guidanceIcon(
  guidance: boolean,
  text: string,
): { icon: LucideIcon; tint?: string; dot?: boolean } {
  if (!guidance) return { icon: Check };
  if (REJECTS.test(text)) return { icon: X, tint: "tint-rose", dot: true };
  if (ACCEPTS.test(text)) return { icon: Check, tint: "tint-emerald", dot: true };
  return { icon: ArrowRight, dot: true };
}

function IconRow({
  icon: Icon,
  tint,
  dot,
  body,
}: {
  icon: LucideIcon;
  tint?: string;
  dot?: boolean;
  body: ReactNode;
}) {
  return (
    <li className="flex gap-2">
      {dot ? (
        <span className={cn("scheme-tip-dot", tint)} aria-hidden>
          <Icon strokeWidth={3.25} />
        </span>
      ) : (
        <span className={cn("mt-[0.2em] shrink-0", tint)} aria-hidden>
          <Icon className="size-[1.1em] text-[color:var(--tint)]" strokeWidth={2.75} />
        </span>
      )}
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
