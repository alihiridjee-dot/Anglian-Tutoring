import { Sparkles, Users, BookOpen, ClipboardCheck, LineChart, Video } from "lucide-react";

const OFFERS = [
  {
    id: "live",
    title: "Live weekly lessons",
    desc: "Interactive sessions on Microsoft Teams. Recorded so you never miss one.",
    icon: Video,
  },
  {
    id: "homework",
    title: "Marked homework",
    desc: "Submit directly in the platform. Tutor grades and personalised feedback within 48 hrs.",
    icon: ClipboardCheck,
  },
  {
    id: "mcq",
    title: "Weekly MCQ quizzes",
    desc: "AI-crafted, tutor-approved multiple choice questions. Instant feedback and explanations.",
    icon: BookOpen,
  },
  {
    id: "predictor",
    title: "Grade predictor",
    desc: "Track quiz and homework trends to forecast your GCSE grade with confidence.",
    icon: LineChart,
  },
  {
    id: "parent",
    title: "Parent dashboard",
    desc: "Parents get their own login to track progress, attendance, and predicted grades.",
    icon: Users,
  },
  {
    id: "curriculum",
    title: "Spec-aligned curriculum",
    desc: "Every resource tagged to the exact spec point for Edexcel, AQA, or OCR.",
    icon: Sparkles,
  },
];

export function OfferSection() {
  return (
    <section id="offer" className="py-20 lg:py-24 bg-slate-50/50 border-t border-slate-100">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-xs uppercase tracking-widest text-slate-500 font-bold">
            OUR COMPREHENSIVE PLATFORM
          </span>
          <h2 className="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
            Everything you need to get top grades
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {OFFERS.map((o) => {
            const Icon = o.icon;
            return (
              <div
                key={o.id}
                className="rounded-2xl bg-white border border-slate-100 p-6 hover:border-slate-300 transition shadow-sm duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-5">
                  <Icon className="w-5.5 h-5.5 text-slate-800" />
                </div>
                <h3 className="font-display text-lg font-bold text-slate-900">{o.title}</h3>
                <p className="mt-2.5 text-sm text-slate-500 leading-relaxed">{o.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
