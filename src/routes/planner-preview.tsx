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
import { ChangesPanel } from "@/components/planner/workbench/ChangesPanel";
import { NeedsYou, type Need } from "@/components/planner/workbench/NeedsYou";
import { PlanGrid } from "@/components/planner/workbench/PlanGrid";
import { QuestionLevelWord } from "@/components/practice/QuestionLevel";
import { RosterGrid, type RosterRow } from "@/components/planner/workbench/RosterGrid";
import type { RosterFilter } from "@/components/planner/useTutorPlanner";
import { TopicOrderPanel } from "@/components/planner/workbench/TopicOrderPanel";
import { WeekReviewView } from "@/components/planner/workbench/WeekReviewPanel";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import type { PointStatus, WeekSummary } from "@/lib/planner/coverage";
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
          "AQA 3.1.4.2",
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
          "EDEX 3.13",
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
          "EDEX 1.1",
          "Principles of homeostasis",
          HOM,
          say("To do"),
          say("To do"),
          s("not_done"),
        ),
        r(
          "2026-11-16",
          "course",
          "EDEX 2.17B",
          "Structure and function of the nervous system",
          HOM,
          say("Handed in"),
          say("To do"),
          s("practised", { ticked: "Tue 17 Nov", last: "Tue 17 Nov" }),
        ),
        r(
          "2026-11-16",
          "course",
          "EDEX 3.9B",
          "Reflex actions",
          HOM,
          say("None yet"),
          say("To do"),
          s("not_done"),
        ),
        r(
          "2026-11-16",
          "catchup",
          "EDEX 3.13",
          "Cell specialisation and differentiation",
          CELL,
          mark(39),
          say("To do"),
          s("weak", { last: "Mon 16 Nov" }),
        ),
        r(
          "2026-11-16",
          "revision",
          "AQA 3.1.4.2",
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

/** An empty week summary, for the made-up lanes to fill in. */
const NONE: WeekSummary = {
  total: 0,
  strong: 0,
  practised: 0,
  weak: 0,
  notDone: 0,
  notSet: 0,
  toRevisit: [],
  covered: [],
  verdict: "no_signal",
};

const set = (total: number, done = 0, pinned = 0) => ({ total, done, pinned });
const unopened = { note: "Not opened yet" };
const ROSTER: RosterRow[] = [
  {
    id: "1",
    name: "Sam Carter",
    level: "GCSE",
    lastOn: "Thu 19 Nov",
    cells: { biology: set(10, 4), chemistry: set(12, 2, 3) },
  },
  {
    id: "2",
    name: "Priya Nair",
    level: "GCSE",
    lastOn: "Mon 16 Nov",
    cells: { physics: set(10), biology: unopened },
  },
  {
    id: "3",
    name: "Tom Okafor-Whitmore",
    level: "A-Level",
    lastOn: "Fri 20 Nov",
    cells: { chemistry: set(11, 11) },
  },
  {
    id: "4",
    name: "Mia Kowalski",
    level: "International GCSE",
    lastOn: null,
    cells: { biology: unopened, chemistry: unopened, physics: unopened },
  },
  {
    id: "5",
    name: "Leo Hart",
    level: "International GCSE",
    lastOn: "Sat 14 Nov",
    cells: { biology: set(7, 1), chemistry: set(6, 0, 6), physics: { note: "On a break" } },
  },
  { id: "6", name: "Ava Lin", level: "GCSE", lastOn: "Wed 18 Nov", cells: { biology: set(0) } },
];

type Part = "needs" | "plan" | "review" | "changes" | "order";
const PARTS: { key: Part; label: string }[] = [
  { key: "needs", label: "Alerts" },
  { key: "plan", label: "Plan" },
  { key: "review", label: "Week review" },
  { key: "changes", label: "Changes" },
  { key: "order", label: "Topic order" },
];

function PlannerPreview() {
  const [subject, setSubject] = useState("biology");
  const [months, setMonths] = useState(MONTHS);
  const [month, setMonth] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [solo, setSolo] = useState<Part>("needs");
  const [note, setNote] = useState("");
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
  const [find, setFind] = useState("");
  const [rosterShow, setRosterShow] = useState<RosterFilter>("all");
  const [rosterWeek, setRosterWeek] = useState(0);
  const roster = ROSTER.filter((row) => row.name.toLowerCase().includes(find.trim().toLowerCase()));
  const part = (key: Part) => cn("min-w-0 lg:block", solo !== key && "hidden");
  return (
    <div className={cn(SUBJECT_TINT.biology, "bg-background min-h-screen px-3 py-4 sm:px-5")}>
      <div className="mx-auto max-w-[110rem] space-y-3">
        {/* The page with nobody open: the roster. */}
        <RosterGrid
          rows={roster}
          total={ROSTER.length}
          subjects={["biology", "chemistry", "physics"]}
          week={{
            title:
              rosterWeek === 0
                ? "This week"
                : rosterWeek === 1
                  ? "Next week"
                  : `${rosterWeek} weeks away`,
            dates: "16–22 Nov 2026",
            isCurrent: rosterWeek === 0,
            onShift: (n) => setRosterWeek((w) => w + n),
            onToday: () => setRosterWeek(0),
          }}
          query={find}
          onQuery={setFind}
          filter={rosterShow}
          onFilter={setRosterShow}
          onOpen={(id, subject) => toast(`Opens student ${id}${subject ? ` on ${subject}` : ""}.`)}
        />
        {/* The page with a student open: their workbench. */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <h1 className="text-xl font-extrabold">Sam Carter</h1>
          <b>GCSE · AQA</b>
          <QuestionLevelWord load="reduced" />
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
          <div
            className={cn(part("review"), "premium-card p-3 sm:p-4 lg:order-last lg:col-span-2")}
          >
            <WeekReviewView
              firstName="Sam"
              lanes={[
                {
                  lane: "core",
                  summary: {
                    ...NONE,
                    total: 10,
                    notDone: 7,
                    weak: 2,
                    strong: 1,
                    verdict: "keep_going",
                  },
                },
                {
                  lane: "focus",
                  summary: { ...NONE, total: 3, strong: 2, practised: 1, verdict: "move_on" },
                },
                { lane: "tutor", summary: { ...NONE, total: 1, notSet: 1, verdict: "no_signal" } },
              ]}
              checkin={{
                felt: "Wanted more practice.",
                said: "I keep mixing up the order of the reflex arc.",
              }}
              note={{
                state: "ready",
                value: note,
                onChange: setNote,
                saving: false,
                drafting: false,
                onSave: () => toast.success("Saved, in the made-up data."),
                onDraft: () => toast("The draft needs a real week's marks."),
              }}
            />
          </div>
          <div
            className={cn(part("changes"), "premium-card p-3 sm:p-4 lg:order-last lg:col-span-2")}
          >
            <ChangesPanel
              changes={[
                {
                  id: "1",
                  at: "2026-11-19T16:20:00Z",
                  kind: "moved",
                  text: "Nadia moved EDEX 2.17B Structure and function of the nervous system from 16–22 Nov 2026 to 23–29 Nov 2026.",
                },
                {
                  id: "2",
                  at: "2026-11-19T16:18:00Z",
                  kind: "added",
                  text: "A tutor added EDEX 2.7 Coronary heart disease to 16–22 Nov 2026.",
                },
                {
                  id: "3",
                  at: "2026-11-18T10:02:00Z",
                  kind: "removed",
                  text: "Ali removed EDEX 3.9B Reflex actions from 16–22 Nov 2026.",
                },
                {
                  id: "4",
                  at: "2026-11-18T09:40:00Z",
                  kind: "skipped",
                  text: "Ali skipped EDEX 1.5 Culturing microorganisms for good.",
                },
                {
                  id: "5",
                  at: "2026-11-16T08:05:00Z",
                  kind: "carried",
                  text: "EDEX 3.13 Cell specialisation and differentiation was carried from 26 Oct – 1 Nov 2026 into 16–22 Nov 2026.",
                },
                {
                  id: "6",
                  at: "2026-11-14T19:00:00Z",
                  kind: "break",
                  text: "A break was booked: 30 Nov – 6 Dec.",
                },
              ]}
            />
          </div>
          <aside className="space-y-3 lg:sticky lg:top-3">
            <div className={cn(part("needs"), "space-y-3")}>
              {(
                [
                  ["To answer", (n: Need) => n.canReply === true],
                  ["About the plan", (n: Need) => n.kind === "plan"],
                ] as const
              ).map(([title, mine]) => (
                <NeedsYou
                  key={title}
                  title={title}
                  needs={needs.filter(mine)}
                  busy={null}
                  onReply={async (need) => {
                    setWaiting((now) => now.filter((n) => n.id !== need.id));
                    toast.success("Sent, in the made-up data.");
                    return true;
                  }}
                  onSettle={(need) => setWaiting((now) => now.filter((n) => n.id !== need.id))}
                />
              ))}
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
