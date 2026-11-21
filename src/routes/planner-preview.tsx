import { useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { toast } from "sonner";
import { Ring, SubjectToggle } from "@/components/Shared";
import { Tally, type Work } from "@/components/planner/workbench/figures";
import {
  type GridMonth,
  type GridRow,
  type GridWeek,
  type LaneKey,
  type Show,
  type TopicRow,
} from "@/components/planner/workbench/gridData";
import { NeedsYou, type Need } from "@/components/planner/workbench/NeedsYou";
import { PlanGrid } from "@/components/planner/workbench/PlanGrid";
import { TopicOrderPanel } from "@/components/planner/workbench/TopicOrderPanel";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import type { PointStatus } from "@/lib/planner/coverage";
import { cn } from "@/lib/utils";

// DEV ONLY — the tutor's workbench panels (the real ones the planner mounts in
// TutorWorkbench) drawn over made-up data. No session can sign in as a tutor,
// so this is where the workbench is looked at: laptop and phone, every lane,
// a past month, a break. Moving and removing change the made-up data only.
export const Route = createFileRoute("/planner-preview")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Tutor workbench — Anglia Educate" }] }),
  component: PlannerPreview,
});

const mark = (n: number): Work => ({ mark: n });
const say = (text: string): Work => ({ text });
const HOM = "Homeostasis and response";
const CELL = "Cell biology";
const ORG = "Organisation";

const r = (
  week: string,
  lane: LaneKey,
  code: string,
  title: string,
  topic: string,
  task: Work,
  quiz: Work,
  rest: Partial<GridRow> = {},
): GridRow => ({
  id: `${week}:${code}`,
  specPointId: code,
  week,
  lane,
  code,
  title,
  topic,
  task,
  quiz,
  status: null,
  missed: false,
  ticked: null,
  last: null,
  ...rest,
});
const s = (status: PointStatus, rest: Partial<GridRow> = {}) => ({ status, ...rest });
const w = (
  key: string,
  dates: string,
  tag: GridWeek["tag"],
  rows: GridRow[],
  rest: Partial<GridWeek> = {},
): GridWeek => ({
  key,
  dates,
  tag,
  note: null,
  unopened: false,
  locked: tag === "Past",
  rows,
  ...rest,
});

const MONTHS: GridMonth[] = [
  {
    key: "2026-10",
    label: "Oct",
    weeks: [
      w("2026-10-12", "12–18 Oct 2026", "Past", [
        r(
          "2026-10-12",
          "course",
          "1.1",
          "Eukaryotes and prokaryotes",
          CELL,
          mark(74),
          mark(70),
          s("strong", { ticked: "Mon 12 Oct", last: "Mon 12 Oct" }),
        ),
        r(
          "2026-10-12",
          "course",
          "1.2",
          "Animal and plant cells",
          CELL,
          mark(81),
          mark(75),
          s("strong", { ticked: "Wed 14 Oct", last: "Wed 14 Oct" }),
        ),
      ]),
      w("2026-10-26", "26 Oct – 1 Nov 2026", "Past", [
        r(
          "2026-10-26",
          "course",
          "1.3",
          "Cell specialisation and differentiation",
          CELL,
          say("Not done"),
          say("Not done"),
          s("not_done", { missed: true }),
        ),
        r(
          "2026-10-26",
          "course",
          "1.4",
          "Microscopy",
          CELL,
          say("Not done"),
          say("Not done"),
          s("not_done", { missed: true }),
        ),
        r(
          "2026-10-26",
          "course",
          "1.5",
          "Culturing microorganisms",
          CELL,
          say("Not done"),
          mark(40),
          s("weak", { last: "Thu 29 Oct" }),
        ),
      ]),
    ],
  },
  {
    key: "2026-11",
    label: "Nov",
    weeks: [
      w("2026-11-09", "9–15 Nov 2026", "Past", [
        r(
          "2026-11-09",
          "course",
          "2.5",
          "The heart and blood vessels",
          ORG,
          mark(82),
          mark(90),
          s("strong", { ticked: "Wed 11 Nov", last: "Wed 11 Nov" }),
        ),
        r(
          "2026-11-09",
          "course",
          "2.6",
          "Blood",
          ORG,
          say("Handed in"),
          mark(70),
          s("strong", { ticked: "Thu 12 Nov", last: "Thu 12 Nov" }),
        ),
        r(
          "2026-11-09",
          "course",
          "2.7",
          "Coronary heart disease",
          ORG,
          say("Not done"),
          mark(45),
          s("weak", { last: "Fri 13 Nov" }),
        ),
      ]),
      w("2026-11-16", "16–22 Nov 2026", "This week", [
        r(
          "2026-11-16",
          "course",
          "5.1",
          "Principles of homeostasis",
          HOM,
          say("To do"),
          say("To do"),
          s("not_done"),
        ),
        r(
          "2026-11-16",
          "course",
          "5.2",
          "Structure and function of the nervous system",
          HOM,
          say("Handed in"),
          say("To do"),
          s("practised", { ticked: "Tue 17 Nov", last: "Tue 17 Nov" }),
        ),
        r(
          "2026-11-16",
          "course",
          "5.3",
          "Reflex actions",
          HOM,
          say("None yet"),
          say("To do"),
          s("not_done"),
        ),
        r(
          "2026-11-16",
          "catchup",
          "1.3",
          "Cell specialisation and differentiation",
          CELL,
          mark(39),
          say("To do"),
          s("weak", { last: "Mon 16 Nov" }),
        ),
        r(
          "2026-11-16",
          "revision",
          "1.1",
          "Eukaryotes and prokaryotes",
          CELL,
          say("None yet"),
          say("To do"),
          s("not_done", { last: "Mon 12 Oct" }),
        ),
        r(
          "2026-11-16",
          "tutor",
          "2.7",
          "Coronary heart disease",
          ORG,
          say("To do"),
          say("To do"),
          s("not_done", { last: "Fri 13 Nov" }),
        ),
      ]),
      w("2026-11-23", "23–29 Nov 2026", "Forecast", [
        r("2026-11-23", "course", "5.4", "The brain", HOM, say("Ready"), say("Ready")),
        r("2026-11-23", "course", "5.5", "The eye", HOM, say("None yet"), say("Ready")),
        r("2026-11-23", "catchup", "1.4", "Microscopy", CELL, say("Ready"), say("Ready")),
        r(
          "2026-11-23",
          "revision",
          "1.2",
          "Animal and plant cells",
          CELL,
          mark(81),
          mark(75),
          s("strong", { last: "Wed 14 Oct" }),
        ),
      ]),
      w("2026-11-30", "30 Nov – 6 Dec 2026", "Forecast", [], { note: "Break", locked: true }),
    ],
  },
  {
    key: "2026-12",
    label: "Dec",
    weeks: [
      w("2026-12-07", "7–13 Dec 2026", "Forecast", [
        r(
          "2026-12-07",
          "course",
          "5.6",
          "Control of body temperature",
          HOM,
          say("None yet"),
          say("None yet"),
        ),
        r("2026-12-07", "course", "5.7", "Human endocrine system", HOM, say("Ready"), say("Ready")),
      ]),
    ],
  },
];

const TOPICS: TopicRow[] = [
  { topicId: "1", title: "Cell biology", when: "5 Oct – 1 Nov 2026", state: "done" },
  { topicId: "2", title: "Organisation", when: "2–15 Nov 2026", state: "done" },
  { topicId: "5", title: "Homeostasis and response", when: "16 Nov – 13 Dec 2026", state: "now" },
  { topicId: "3", title: "Infection and response", when: "14 Dec 2026 – 17 Jan 2027", state: null },
  { topicId: "4", title: "Bioenergetics", when: "18 Jan – 14 Feb 2027", state: null },
];

type Part = "needs" | "plan" | "order";
const PARTS: { key: Part; label: string }[] = [
  { key: "needs", label: "Needs you" },
  { key: "plan", label: "Plan" },
  { key: "order", label: "Topic order" },
];

function PlannerPreview() {
  const [subject, setSubject] = useState("biology");
  const [months, setMonths] = useState(MONTHS);
  const [month, setMonth] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [solo, setSolo] = useState<Part>("needs");
  const [waiting, setWaiting] = useState<Need[]>([
    {
      id: "c",
      kind: "checkin",
      when: "Wed 18 Nov",
      text: "Wanted more practice. “I keep mixing up the order of the reflex arc.”",
      canReply: true,
    },
    {
      id: "m",
      kind: "message",
      when: "Thu 19 Nov",
      text: "Can we go over the nervous system again in Saturday's lesson?",
      canReply: true,
    },
    {
      id: "p",
      kind: "parent",
      when: "Tue 17 Nov",
      text: "Is he keeping up with the catch-up work?",
      canReply: true,
    },
  ]);
  const needs: Need[] = [
    ...waiting,
    {
      id: "missed",
      kind: "missed",
      when: "Since 26 Oct",
      text: "2 points in Cell biology",
      action: {
        label: "Show in the plan",
        run: () => {
          setShow("missed");
          setMonth("2026-10");
          setSolo("plan");
        },
      },
    },
    {
      id: "plan",
      kind: "plan",
      when: "Waiting",
      text: "The plan has changed. It applies when Sam next opens their planner.",
    },
  ];
  /** Take lines out of every week, and put `into` one week. */
  const rewrite = (out: Set<string>, into: GridRow[] = [], to?: string) =>
    setMonths((now) =>
      now.map((m) => ({
        ...m,
        weeks: m.weeks.map((wk) => ({
          ...wk,
          rows: [...wk.rows.filter((row) => !out.has(row.id)), ...(wk.key === to ? into : [])],
        })),
      })),
    );
  const part = (key: Part) => cn("min-w-0 lg:block", solo !== key && "hidden");
  return (
    <div className={cn(SUBJECT_TINT.biology, "bg-background min-h-screen px-3 py-4 sm:px-5")}>
      <div className="mx-auto max-w-[110rem] space-y-3">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <h1 className="text-xl font-extrabold">Sam Carter</h1>
          <b>GCSE · AQA</b>
          <SubjectToggle
            subjects={["biology", "physics", "chemistry"]}
            value={subject}
            onChange={setSubject}
            layoutId="planner-preview-subject"
          />
          <span className="whitespace-nowrap">
            Exams <b>7 Jun 2027</b>
          </span>
          <Tally n={29} word="weeks to go" />
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Ring value={29} size={32} stroke={3.5} className="tint-emerald">
              <span className="numeral text-xs">2</span>
            </Ring>
            of 7 topics covered
          </span>
        </header>
        <div role="tablist" aria-label="Parts" className="flex gap-1.5 overflow-x-auto lg:hidden">
          {PARTS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={solo === p.key}
              onClick={() => setSolo(p.key)}
              className={cn(
                solo === p.key ? "btn-solid" : "btn-soft",
                "min-h-11 shrink-0 rounded-lg px-3 text-sm",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className={part("plan")}>
            <PlanGrid
              months={months}
              month={month}
              onMonth={setMonth}
              show={show}
              onShow={setShow}
              busy={false}
              onMove={(rows, to) => {
                const moving = rows.filter((row) => row.week !== to);
                rewrite(
                  new Set(moving.map((row) => row.id)),
                  moving.map((row) => ({ ...row, week: to, id: `${to}:${row.code}` })),
                  to,
                );
                toast.success(`Moved ${moving.length} in the made-up data.`);
              }}
              onRemove={(rows) => {
                rewrite(new Set(rows.map((row) => row.id)));
                toast.success(`Removed ${rows.length} from the made-up data.`);
              }}
              onSkip={(rows) => toast(`Skip ${rows.length}: nothing to skip in made-up data.`)}
              onAdd={(week) => toast(`Add to ${week.dates}: the point picker needs a real course.`)}
            />
          </div>
          <aside className="space-y-3 lg:sticky lg:top-3">
            <div className={part("needs")}>
              <NeedsYou
                needs={needs}
                busy={null}
                onReply={async (need) => {
                  setWaiting((now) => now.filter((n) => n.id !== need.id));
                  toast.success("Sent, in the made-up data.");
                  return true;
                }}
                onSettle={(need) => setWaiting((now) => now.filter((n) => n.id !== need.id))}
              />
            </div>
            <div className={part("order")}>
              <TopicOrderPanel
                topics={TOPICS}
                percent={29}
                onChange={() => toast("The order editor needs a real course.")}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
