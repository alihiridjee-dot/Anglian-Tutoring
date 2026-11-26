import { useState, type ReactNode } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft, Clock, MessageSquarePlus } from "lucide-react";
import { EnrolmentSummary } from "@/components/CourseBadge";
import { DEMO_PORTAL } from "@/components/demo/parentPortalDemo";
import { ChildGradesCard } from "@/components/parent/ChildGradesCard";
import { ChildWeekCard } from "@/components/parent/ChildWeekCard";
import { EngagementStats } from "@/components/parent/EngagementStats";
import { CTRL, Tally, TINT_TEXT } from "@/components/planner/workbench/figures";
import { QUESTION_LEVELS } from "@/components/practice/questionLevels";
import { Ring, SectionHeading, SegmentedToggle } from "@/components/Shared";
import { AnswerMarkingList } from "@/components/tutor/AnswerMarking";
import type { QuestionMark } from "@/hooks/data/useAnswerMarking";
import type { HomeworkAnswer, HomeworkQuestion } from "@/hooks/data/useHomeworkQuestions";
import {
  DEFAULT_QUESTION_LOAD,
  HEAVIEST_LIVE_LOAD,
  QUESTION_CAPS,
  minutesPerDay,
  type QuestionLoad,
} from "@/lib/practice/questionLoad";
import { cn } from "@/lib/utils";

// DEV ONLY, AND TEMPORARY — the looks Ali picks from for showing a tutor and a
// parent which question level a student is on (26 Nov 2026). Each place is a
// copy of the real screen's markup over made-up data, with the new piece drawn
// in two or three ways. Deleted once a look is built into the real screens.
export const Route = createFileRoute("/level-preview")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Question level looks — Anglia Educate" }] }),
  component: LevelPreview,
});

type NameLook = "name" | "counts" | "offNormal";
type MarkLook = "inside" | "row" | "both";
type ParentLook = "ribbon" | "line" | "card";

/** The level's emoji and name, and its two counts in dots when asked for. */
function LevelWord({
  load,
  counts = false,
  className,
}: {
  load: QuestionLoad;
  counts?: boolean;
  className?: string;
}) {
  const level = QUESTION_LEVELS[load];
  const caps = QUESTION_CAPS[load];
  return (
    <span
      className={cn(level.tint, "inline-flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}
      title={`How many questions: ${level.name} (${caps.quiz} MCQs in each quiz, ${caps.task} written questions in each task)`}
    >
      <b className="whitespace-nowrap">
        <span aria-hidden>{level.emoji}</span> <span className="sr-only">Questions: </span>
        {level.name}
      </b>
      {counts && (
        <>
          <Tally n={caps.quiz} word="MCQs" />
          <Tally n={caps.task} word="written" />
        </>
      )}
    </span>
  );
}

/** A count in a solid dot, as the student's own picker draws it. */
function Count({ n, word }: { n: number; word: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="qload-count numeral">{n}</span>
      {word}
    </span>
  );
}

function Place({
  title,
  looks,
  look,
  onLook,
  children,
}: {
  title: string;
  looks: { value: string; label: string }[];
  look: string;
  onLook: (look: string) => void;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-extrabold">{title}</h2>
        <SegmentedToggle
          layoutId={`look-${title}`}
          label={`Look for ${title}`}
          value={look}
          onChange={onLook}
          items={looks}
        />
      </div>
      {children}
    </section>
  );
}

function LevelPreview() {
  const [load, setLoad] = useState<QuestionLoad>("reduced");
  const [nameLook, setNameLook] = useState<NameLook>("name");
  const [markLook, setMarkLook] = useState<MarkLook>("inside");
  const [parentLook, setParentLook] = useState<ParentLook>("line");

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24">
      <div className="bg-background sticky top-0 z-20 -mx-4 mb-8 flex flex-wrap items-center gap-3 px-4 py-3">
        <b>The student is on</b>
        <SegmentedToggle
          layoutId="preview-load"
          label="The student's level"
          value={load}
          onChange={(v) => setLoad(v as QuestionLoad)}
          items={[
            { value: "reduced", label: "🪶 Reduced" },
            { value: "normal", label: "🎯 Normal" },
          ]}
        />
      </div>

      <div className="space-y-16">
        <Place
          title="Tutor: beside the student's name"
          look={nameLook}
          onLook={(v) => setNameLook(v as NameLook)}
          looks={[
            { value: "name", label: "A · The name" },
            { value: "counts", label: "B · Name and counts" },
            { value: "offNormal", label: "C · Only when it isn't Normal" },
          ]}
        >
          <TutorName load={load} look={nameLook} />
        </Place>

        <Place
          title="Tutor: the marking card"
          look={markLook}
          onLook={(v) => setMarkLook(v as MarkLook)}
          looks={[
            { value: "inside", label: "A · Inside the card" },
            { value: "row", label: "B · On the row" },
            { value: "both", label: "C · Both" },
          ]}
        >
          <MarkingCard load={load} look={markLook} />
        </Place>

        <Place
          title="Parent: the portal"
          look={parentLook}
          onLook={(v) => setParentLook(v as ParentLook)}
          looks={[
            { value: "ribbon", label: "A · In the ribbon" },
            { value: "line", label: "B · A line on the page" },
            { value: "card", label: "C · A card with the ring" },
          ]}
        >
          <ParentPortal load={load} look={parentLook} />
        </Place>
      </div>
    </main>
  );
}

/* ── Tutor: the student record's header and the planner's ───────────────── */

function TutorLevel({ load, look }: { load: QuestionLoad; look: NameLook }) {
  if (look === "offNormal" && load === DEFAULT_QUESTION_LOAD) return null;
  return <LevelWord load={load} counts={look === "counts"} />;
}

function TutorName({ load, look }: { load: QuestionLoad; look: NameLook }) {
  const outOf = QUESTION_CAPS[load].quiz;
  const attempts = [
    { title: "B4.2 Enzymes", when: "24 Nov 2026, 17:42", score: outOf - 1 },
    { title: "B4.1 Food tests", when: "23 Nov 2026, 18:05", score: outOf - 3 },
    { title: "B3.4 Active transport", when: "21 Nov 2026, 10:16", score: outOf },
  ];
  return (
    <div className="space-y-10">
      {/* StudentHeader, as StudentRecordPage fills it. */}
      <div>
        <h3 className="mb-3 text-lg font-bold">Student record</h3>
        <div className="premium-card tint-primary flex flex-wrap items-center gap-5 rounded-2xl p-5 sm:p-6">
          <div className="icon-tile size-16 shrink-0 overflow-hidden text-xl font-black">
            <span aria-hidden>MP</span>
          </div>
          <div className="min-w-0 flex-1 sm:basis-56">
            <p className="eyebrow eyebrow-bare">Student</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="font-display truncate text-2xl font-extrabold sm:text-3xl">
                Maya Patel
              </p>
              <TutorLevel load={load} look={look} />
            </div>
            <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
              <span className="truncate">maya.patel@example.com</span>
              <span>Joined 4 Sep 2026</span>
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
            <span className="chip tint-primary text-[10px]">GCSE</span>
            <span className="chip tint-bio text-[10px]">Biology</span>
            <span className="chip tint-chem text-[10px]">Chemistry</span>
            <span className="chip tint-emerald text-[10px]">Active</span>
          </div>
        </div>

        {/* The record's Quizzes tab, where "5/6" sits beside another student's "5/8". */}
        <section className="premium-card mt-6 overflow-hidden rounded-2xl">
          <div className="p-5 pb-3 sm:p-6 sm:pb-3">
            <SectionHeading title="Attempts" />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground text-xs tracking-widest uppercase">
              <tr>
                <th className="px-4 py-3 text-left sm:px-5">Quiz</th>
                <th className="hidden px-4 py-3 text-left sm:table-cell sm:px-5">When</th>
                <th className="px-4 py-3 text-left sm:px-5">Score</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {attempts.map((a) => {
                const pct = Math.round((a.score / outOf) * 100);
                return (
                  <tr key={a.title}>
                    <td className="px-4 py-3 font-semibold sm:px-5">{a.title}</td>
                    <td className="text-muted-foreground hidden px-4 py-3 text-xs sm:table-cell sm:px-5">
                      {a.when}
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <span
                        className={cn(
                          "numeral text-lg text-[color:var(--tint)]",
                          pct >= 70 ? "tint-emerald" : "tint-amber",
                        )}
                      >
                        {pct}%
                      </span>
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        {a.score}/{outOf}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      {/* TutorWorkbench's header line. */}
      <div>
        <h3 className="mb-3 text-lg font-bold">Planner, with the student open</h3>
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <button type="button" className={CTRL}>
            <ArrowLeft className="size-4" aria-hidden /> Students
          </button>
          <p className="font-display text-xl font-extrabold">Maya Patel</p>
          <b>GCSE AQA</b>
          <TutorLevel load={load} look={look} />
          <span className="whitespace-nowrap">
            Exams <b>11 May 2027</b>
          </span>
          <Tally n={24} word="weeks to go" />
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Ring value={38} size={32} stroke={3.5} className="tint-emerald">
              <span className="numeral text-xs">43</span>
            </Ring>
            of 112 topics covered
          </span>
          <span className="whitespace-nowrap">
            Last on <b>Tue 24 Nov</b>
          </span>
        </header>
      </div>
    </div>
  );
}

/* ── Tutor: the marking card ────────────────────────────────────────────── */

const TASK = "task-enzymes";
const q = (n: number, marks: number, prompt: string, scheme: string): HomeworkQuestion => ({
  id: `q${n}`,
  resource_id: TASK,
  position: n,
  prompt,
  marks,
  answer_type: marks > 3 ? "long" : "short",
  mark_scheme: scheme,
  spec_point_id: null,
});

/** The task as stored: five questions, of which a level sets the first few. */
const STORED: HomeworkQuestion[] = [
  q(
    1,
    2,
    "State what is meant by the active site of an enzyme.",
    "The part of the enzyme the substrate fits into (1)\nIt has a shape that matches the substrate (1)",
  ),
  q(
    2,
    3,
    "Explain why amylase breaks down starch but not protein.",
    "The active site has a specific shape (1)\nStarch fits the active site (1)\nProtein is a different shape, so it does not fit (1)",
  ),
  q(
    3,
    4,
    "Describe and explain the effect of raising the temperature from 20 °C to 60 °C on the rate of an enzyme reaction.",
    "Rate rises up to the optimum (1)\nMore kinetic energy, so more collisions (1)\nAbove the optimum the rate falls (1)\nThe enzyme is denatured, so the active site changes shape (1)",
  ),
  q(
    4,
    5,
    "A student tests how pH changes the time amylase takes to digest starch. Describe a method they could use.",
    "Buffer solutions at a range of pH (1)\nSame volume and concentration of amylase and starch (1)\nSample at fixed times onto iodine (1)\nRecord the time until the iodine stays orange (1)\nRepeat and find a mean (1)",
  ),
  q(
    5,
    6,
    "Evaluate the student's method and suggest two ways to make the results more accurate.",
    "Level 3 (5–6): a detailed evaluation with two valid improvements, each explained.",
  ),
];

const ANSWERS = [
  "The active site is the part of the enzyme where the substrate fits in. It has a shape that matches the substrate.",
  "Amylase has an active site with a specific shape. Starch fits into it but protein is a different shape so it can't fit.",
  "As the temperature goes up the rate goes up because the particles have more energy and collide more. After about 40 °C the rate goes down because the enzyme is denatured.",
  "Use buffers at pH 4, 5, 6, 7 and 8. Put the same amount of amylase and starch in each. Every 30 seconds put a drop on iodine and time how long until it stays orange.",
  "The method is good because the volumes are kept the same. It could be more accurate with a water bath and by repeating each pH three times.",
];
const AWARDED = ["2", "3", "3", "4", "4"];

function MarkingCard({ load, look }: { load: QuestionLoad; look: MarkLook }) {
  const [open, setOpen] = useState(true);
  const set = Math.min(STORED.length, QUESTION_CAPS[load].task);
  const leftOut = STORED.length - set;
  const questions = STORED.slice(0, set);
  const answers: Record<string, HomeworkAnswer> = {};
  const [marks, setMarks] = useState<Record<string, QuestionMark>>(() =>
    Object.fromEntries(STORED.map((x, i) => [x.id, { marks: AWARDED[i], feedback: "" }])),
  );
  questions.forEach((x, i) => {
    answers[x.id] = {
      id: `a${i}`,
      submission_id: "s1",
      question_id: x.id,
      answer_text: ANSWERS[i],
      awarded_marks: null,
      feedback: null,
    };
  });
  const total = questions.reduce((n, x) => n + x.marks, 0);
  const awarded = questions.reduce((n, x) => n + Number(marks[x.id]?.marks || 0), 0);
  // Drawn only for a paper that was cut: on Normal this task is set whole.
  const cut = leftOut > 0;
  const level = QUESTION_LEVELS[load];

  return (
    <div className="bg-card overflow-hidden rounded-2xl border-2 border-[color:color-mix(in_oklab,var(--warning)_40%,transparent)] shadow-xs">
      <div className="flex items-center gap-3 pr-2 pl-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center justify-between gap-4 py-4 pr-4 text-left"
        >
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="bg-primary/10 text-primary rounded px-2 py-0.5 text-[10px] font-semibold tracking-widest uppercase">
                Biology
              </span>
              <span className="tint-amber chip inline-flex items-center gap-1">
                <Clock className="size-2.5" /> Publishes in 5 h
              </span>
            </div>
            <p className="font-display truncate font-bold">B4.2 Enzymes: exam questions</p>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
              <span>Maya Patel · submitted 24/11/2026</span>
              {cut && (look === "row" || look === "both") && (
                <LevelWord load={load} className="text-foreground text-sm" />
              )}
            </p>
          </div>
          <span className="text-muted-foreground shrink-0 text-xs">{open ? "Hide" : "Review"}</span>
        </button>
      </div>

      {open && (
        <div className="border-border bg-muted/20 space-y-5 border-t p-4 sm:p-6">
          <div>
            <p className="text-muted-foreground mb-2 text-[10px] font-extrabold tracking-widest uppercase">
              Submitted work
            </p>
            <div className="space-y-3">
              {cut && (look === "inside" || look === "both") && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                  <LevelWord load={load} />
                  <Tally
                    n={set}
                    word={set === 1 ? "question set" : "questions set"}
                    tint={level.tint}
                  />
                  <Tally n={leftOut} word="left out" tint="tint-slate" />
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                Answered on the site — {set}/{set} marked, {awarded}/{total} marks (
                {Math.round((awarded / total) * 100)}%)
              </p>
              <AnswerMarkingList
                questions={questions}
                answers={answers}
                marks={marks}
                setMark={(id, changes) =>
                  setMarks((prev) => ({ ...prev, [id]: { ...prev[id], ...changes } }))
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Parent: the portal ─────────────────────────────────────────────────── */

function ParentPortal({ load, look }: { load: QuestionLoad; look: ParentLook }) {
  const data = DEMO_PORTAL;
  const level = QUESTION_LEVELS[load];
  const caps = QUESTION_CAPS[load];
  const topics = data.week.reduce((n, w) => n + w.points.length, 0);
  const minutes = minutesPerDay(load, topics);
  const share = (minutes / minutesPerDay(HEAVIEST_LIVE_LOAD, topics)) * 100;

  return (
    <div>
      {/* The welcome ribbon, as ParentDashboard draws it. */}
      <div className="text-primary-foreground shadow-elegant relative mb-6 overflow-hidden rounded-2xl border-2 border-white/15 bg-gradient-to-br from-[var(--primary-deep)] to-[var(--primary)] px-5 py-4 sm:px-6 sm:py-5">
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="bg-accent h-2 w-2 shrink-0 rounded-full" />
            <p className="font-display text-lg font-bold tracking-tight text-white sm:text-xl">
              Welcome back, {data.parentName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-white">{data.childName}</span>
            <EnrolmentSummary enrolments={data.enrolments} level={data.level} />
            {look === "ribbon" && (
              <b className="text-sm whitespace-nowrap text-white">
                <span aria-hidden>{level.emoji}</span> {level.name}
              </b>
            )}
            <button
              type="button"
              className="btn-soft tint-primary inline-flex h-11 items-center gap-1.5 rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
            >
              <MessageSquarePlus className="size-4" aria-hidden /> Message a tutor
            </button>
          </div>
        </div>
      </div>

      {look === "line" && (
        <p
          className={cn(
            level.tint,
            "mb-8 flex flex-wrap items-center gap-x-5 gap-y-2.5 text-[1.0625rem] font-bold",
          )}
        >
          <span>
            {data.childName}&apos;s questions: <span aria-hidden>{level.emoji}</span> {level.name}
          </span>
          <Count n={caps.quiz} word="MCQs in each quiz" />
          <Count n={caps.task} word="written questions in each task" />
        </p>
      )}

      <div className="space-y-8">
        <ChildGradesCard analytics={data.analytics} level={data.level} grades={data.enrolments} />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            <ChildWeekCard weeks={data.week} />
          </div>
          <div className="space-y-8">
            {look === "card" && (
              <div className="premium-card p-4 sm:p-6">
                <SectionHeading title="How many questions" />
                <div className={cn(level.tint, "mt-4 space-y-4 text-[1.0625rem] font-bold")}>
                  <p className="text-xl">
                    <span aria-hidden>{level.emoji}</span> {level.name}
                  </p>
                  <span className="flex items-center gap-2.5 leading-tight">
                    About
                    <Ring key={load} value={share} size={72} stroke={8} className="shrink-0">
                      <span className={cn("numeral pop-in text-2xl", TINT_TEXT)}>{minutes}</span>
                    </Ring>
                    minutes a day
                  </span>
                  <div className="grid gap-2.5">
                    <Count n={caps.quiz} word="MCQs in each quiz" />
                    <Count n={caps.task} word="written questions in each task" />
                  </div>
                </div>
              </div>
            )}
            {data.engagement && <EngagementStats engagement={data.engagement} />}
          </div>
        </div>
      </div>
    </div>
  );
}
