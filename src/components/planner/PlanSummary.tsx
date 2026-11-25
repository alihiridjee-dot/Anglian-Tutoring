import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Ring } from "@/components/Shared";
import { type SubjectV } from "@/lib/curriculum/taxonomy";
import { cn } from "@/lib/utils";
import { TINT_TEXT, Tally } from "./workbench/figures";

/**
 * The course at a glance, above the Full plan: three cards, Exams, Topics and
 * Catch-up. The exam date leads because every week below is paced from it,
 * and each card carries the one action that changes its number.
 *
 * House style (README, "A page of work is a trail"): no eyebrow, no ALL CAPS
 * label, no pills and no loose numbers. A count sits inside a round dot and a
 * share of something inside a ring, with the plain word beside it. Ali picked
 * this look (B, "three cards") from three on 25 Nov 2026.
 */
export function PlanSummary(p: {
  weeksToGo: number;
  examPassed: boolean;
  dateSaved: boolean;
  /**
   * The exam date box. The planner draws it, because the planner decides when
   * a typed or picked date is saved; this only says how it looks.
   */
  dateBox: (className: string) => ReactNode;
  covered: number;
  topics: number;
  owed: number;
  held: number;
  paused: boolean;
  subject: SubjectV;
}) {
  const caughtUp = p.owed === 0;
  return (
    <div className="mb-4 grid gap-3 md:grid-cols-3">
      <Card tint="tint-primary" emoji="🗓️" title="Exams" guide="plan-exams">
        <Figure>
          <Dot>{p.examPassed ? <span aria-hidden>🏁</span> : p.weeksToGo}</Dot>
          {p.examPassed ? "Exams have passed" : p.weeksToGo === 1 ? "week to go" : "weeks to go"}
        </Figure>
        {p.examPassed && (
          <b role="status" className={cn("tint-rose", TINT_TEXT)}>
            Pick your next exam date
          </b>
        )}
        {p.dateSaved && (
          <b role="status" className={cn("tint-emerald", TINT_TEXT)}>
            <span aria-hidden>✅</span> Exam date saved
          </b>
        )}
        <label className="mt-auto">
          <span className="sr-only">Exam date</span>
          {p.dateBox(
            "premium-input h-11 w-full px-3 text-base font-bold focus:outline-none disabled:opacity-50",
          )}
        </label>
      </Card>

      <Card tint="tint-emerald" emoji="📚" title="Topics" guide="plan-covered">
        <Figure>
          <Ring
            value={p.topics ? (p.covered / p.topics) * 100 : 0}
            size={72}
            stroke={8}
            className="shrink-0"
          >
            <span className={cn("numeral text-[1.75rem]", TINT_TEXT)}>{p.covered}</span>
          </Ring>
          of {p.topics} covered
        </Figure>
        <Link
          to="/planner-order"
          search={{ subject: p.subject }}
          className="btn-solid summary-go mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-base"
        >
          <span aria-hidden className="summary-emoji">
            🔀
          </span>
          Reorder topics
        </Link>
      </Card>

      <Card
        tint={caughtUp ? "tint-emerald" : "tint-amber"}
        emoji="🔁"
        title="Catch-up"
        guide="plan-catch-up"
      >
        <Figure>
          <Dot>{caughtUp ? <span aria-hidden>✅</span> : p.owed}</Dot>
          {caughtUp ? "All caught up" : p.owed === 1 ? "point to catch up" : "points to catch up"}
        </Figure>
        {p.held > 0 && (
          <b role="status">
            <Tally n={p.held} word="won’t fit before exams" tint="tint-rose" />
          </b>
        )}
        {/* Missed work comes back on its own, a little each week. Students
            don't add to their week (Ali, 7 Oct): a tutor can, from their
            Full plan. */}
        {p.paused && (
          <b>
            <span aria-hidden>⏸️</span> Paused — catch-up waits for your plan
          </b>
        )}
      </Card>
    </div>
  );
}

function Card({
  tint,
  emoji,
  title,
  guide,
  children,
}: {
  tint: string;
  emoji: string;
  title: string;
  /** What the welcome tour rings this card by. */
  guide: string;
  children: ReactNode;
}) {
  return (
    <section
      data-guide={guide}
      className={cn("premium-card summary-card flex flex-col gap-4 rounded-2xl p-5", tint)}
    >
      <h3 className="flex items-center gap-2 text-lg font-extrabold">
        <span aria-hidden>{emoji}</span> {title}
      </h3>
      {children}
    </section>
  );
}

/** The card's figure, in its dot or ring, and the plain words beside it. */
function Figure({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-3 text-lg leading-tight font-bold">{children}</div>;
}

/** A count, inside a round solid dot in its card's colour. */
function Dot({ children }: { children: ReactNode }) {
  return <span className="summary-dot numeral pop-in">{children}</span>;
}
