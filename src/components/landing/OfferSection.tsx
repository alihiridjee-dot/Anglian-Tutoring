import { Check } from "lucide-react";

import {
  ChatMock,
  FeedbackMock,
  HomeworkMock,
  LiveMock,
  ParentMock,
  PredictorMock,
  ProgrammeMock,
  QuizMock,
} from "@/components/how-it-works/ServicePreviews";

// The two things a place is built on, given the big cards: live teaching, and a
// programme that belongs to one child. Everything else supports those two.
const PILLARS = [
  {
    id: "live",
    eyebrow: "Taught live",
    title: "Up to 3 live sessions a week",
    desc: "Small-group lessons on Zoom with Dr Nadia or Ali. Your child asks questions as they go, and their tutor can see who is keeping up.",
    points: [
      "Taught to your child's exam board, spec point by spec point",
      "Recorded, so a missed week can be caught up",
      "The same two tutors every week, never an agency",
    ],
    preview: LiveMock,
    tint: "tint-primary",
  },
  {
    id: "programme",
    eyebrow: "Personalised programme",
    title: "A plan built around your child",
    desc: "We lay out the whole course from the week your child joins to their exam date. Each week they know exactly what to learn, and what to revisit.",
    points: [
      "Set to their exam board, level and exam date",
      "Weak topics come back, based on their marked work",
      "Reviewed and adjusted by their tutor every week",
    ],
    preview: ProgrammeMock,
    tint: "tint-accent",
  },
];

// Accurate to the platform as built: each of these is a real screen, and each
// card shows a small mock-up of it rather than describing it.
const SUPPORT = [
  {
    id: "homework",
    title: "Homework marked by their tutor",
    desc: "A grade and written comments within 48 hours, from the tutor who taught it.",
    preview: HomeworkMock,
    tint: "tint-bio",
  },
  {
    id: "quiz",
    title: "A weekly quiz",
    desc: "Short multiple-choice quizzes on what they've covered, with instant explanations.",
    preview: QuizMock,
    tint: "tint-chem",
  },
  {
    id: "note",
    title: "A weekly note from their tutor",
    desc: "What clicked, what didn't, and what they're working on next week.",
    preview: FeedbackMock,
    tint: "tint-phys",
  },
  {
    id: "messages",
    title: "Message their tutor",
    desc: "Stuck between lessons? Ask in the platform, and their tutor replies.",
    preview: ChatMock,
    tint: "tint-primary",
  },
  {
    id: "predictor",
    title: "A predicted grade",
    desc: "Worked out from their marked homework and quizzes, so it moves as they improve.",
    preview: PredictorMock,
    tint: "tint-amber",
  },
  {
    id: "parent",
    title: "Your own parent login",
    desc: "See attendance, homework, scores and their predicted grade at any time.",
    preview: ParentMock,
    tint: "tint-accent",
  },
];

export function OfferSection() {
  return (
    <section id="offer" className="py-20 lg:py-24 bg-secondary/50 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="eyebrow">Our comprehensive platform</span>
          <h2 className="font-display text-foreground mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            A personal programme, <span className="marker">taught live</span>
          </h2>
        </div>

        <div className="grid gap-6">
          {PILLARS.map((p, i) => {
            const Preview = p.preview;
            return (
              <div
                key={p.id}
                className={`pop-card pop-card-banded grid items-center gap-8 p-5 sm:p-8 lg:grid-cols-2 lg:gap-12 ${p.tint}`}
              >
                <div>
                  <span className="eyebrow">{p.eyebrow}</span>
                  <h3 className="font-display text-foreground mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
                    {p.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{p.desc}</p>
                  <ul className="mt-5 space-y-2.5">
                    {p.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2.5 text-sm text-foreground/90">
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-[var(--accent)]"
                          aria-hidden
                        />
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={`surface-loud p-5 sm:p-8 ${i % 2 ? "lg:order-first" : ""}`}>
                  <div className="mx-auto w-full max-w-md">
                    <Preview />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {SUPPORT.map((o) => {
            const Preview = o.preview;
            return (
              <div
                key={o.id}
                className={`pop-card pop-card-banded flex flex-col p-5 sm:p-6 ${o.tint}`}
              >
                <h3 className="font-display text-foreground text-lg font-extrabold">{o.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{o.desc}</p>
                <div className="surface-loud mt-5 flex flex-1 items-center p-4">
                  <div className="w-full">
                    <Preview />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
