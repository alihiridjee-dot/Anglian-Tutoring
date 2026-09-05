import { Sparkles, Users, BookOpen, ClipboardCheck, LineChart, Video } from "lucide-react";

const OFFERS = [
  {
    id: "live",
    title: "Live weekly lessons",
    desc: "Interactive sessions on Zoom. Recorded so you never miss one.",
    icon: Video,
    tint: "tint-primary",
  },
  {
    id: "homework",
    title: "Marked homework",
    desc: "Submit directly in the platform. Tutor grades and personalised feedback within 48 hrs.",
    icon: ClipboardCheck,
    tint: "tint-bio",
  },
  {
    id: "mcq",
    title: "Weekly MCQ quizzes",
    desc: "Tutor-approved multiple choice questions. Instant feedback and explanations.",
    icon: BookOpen,
    tint: "tint-chem",
  },
  {
    id: "predictor",
    title: "Grade predictor",
    desc: "Track quiz and homework trends to forecast your GCSE grade with confidence.",
    icon: LineChart,
    tint: "tint-phys",
  },
  {
    id: "parent",
    title: "Parent dashboard",
    desc: "Parents get their own login to track progress, attendance, and predicted grades.",
    icon: Users,
    tint: "tint-accent",
  },
  {
    id: "curriculum",
    title: "Spec-aligned curriculum",
    desc: "Every resource tagged to the exact spec point for Edexcel, AQA, or OCR.",
    icon: Sparkles,
    tint: "tint-amber",
  },
];

export function OfferSection() {
  return (
    <section id="offer" className="py-20 lg:py-24 bg-secondary/50 border-t border-border">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="eyebrow">Our comprehensive platform</span>
          <h2 className="font-display text-foreground mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Everything you need to get <span className="marker">top grades</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {OFFERS.map((o) => {
            const Icon = o.icon;
            return (
              <div
                key={o.id}
                className={`pop-card pop-card-interactive pop-card-banded p-6 ${o.tint}`}
              >
                <div className="icon-tile mb-5 size-12">
                  <Icon className="size-5.5" aria-hidden />
                </div>
                <h3 className="font-display text-foreground text-lg font-extrabold">{o.title}</h3>
                <p className="mt-2.5 text-sm text-muted-foreground leading-relaxed">{o.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
