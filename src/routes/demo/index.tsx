import { createFileRoute, Link } from "@tanstack/react-router";
import { GraduationCap, Users, ArrowLeft, Check, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/demo/")({
  head: () => ({
    meta: [
      { title: "Choose Demo | Anglian Learning" },
      {
        name: "description",
        content:
          "Explore the Anglian Learning platform with our interactive student and parent demos.",
      },
    ],
  }),
  component: DemoPage,
});

/**
 * Entry point to the public showcase.
 *
 * These are plain links. The showcase signs nobody in — it has no account and no
 * session behind it, and every page under /demo/* renders fixtures. Anything
 * resembling a login here would defeat the point.
 */
function DemoPage() {
  return (
    <div className="min-h-screen bg-white relative flex flex-col">
      <div className="absolute top-6 left-6 z-10">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900 transition px-3 py-1.5 rounded-lg hover:bg-slate-50"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 min-h-screen">
        <div className="flex items-center justify-center p-6 sm:p-12 md:p-16 border-b md:border-b-0 md:border-r border-slate-100">
          <DemoCard
            to="/demo/student/dashboard"
            tone="student"
            icon={<GraduationCap className="w-7 h-7" />}
            title="Student Demo"
            blurb="Experience the platform from a student's perspective. Participate in live lectures, attempt quizzes, and review your homework."
            points={[
              "Attend live interactive lectures & ask questions",
              "Complete instant-feedback multiple choice quizzes",
              "Submit homework assignments & view grading feedback",
            ]}
            cta="Explore Student Platform"
          />
        </div>

        <div className="flex items-center justify-center p-6 sm:p-12 md:p-16">
          <DemoCard
            to="/demo/parent/dashboard"
            tone="parent"
            icon={<Users className="w-7 h-7" />}
            title="Parent Demo"
            blurb="See how parents track their child's academic journey, monitor lesson attendance, check predicted grades, and reply directly to tutors."
            points={[
              "Track GCSE predicted grades on a clean 1-9 scale",
              "Check live class attendance & quiz engagement",
              "Read feedback notes & directly reply to science tutors",
            ]}
            cta="Explore Parent Platform"
          />
        </div>
      </div>
    </div>
  );
}

function DemoCard({
  to,
  tone,
  icon,
  title,
  blurb,
  points,
  cta,
}: {
  to: string;
  tone: "student" | "parent";
  icon: React.ReactNode;
  title: string;
  blurb: string;
  points: string[];
  cta: string;
}) {
  const isStudent = tone === "student";
  return (
    <Link
      to={to}
      className={`group max-w-md w-full bg-slate-50/50 hover:bg-slate-50/80 border border-slate-100 rounded-3xl p-8 sm:p-10 shadow-xs hover:shadow-lg transition-all duration-300 flex flex-col justify-between min-h-[460px] ${
        isStudent ? "hover:border-emerald-200/60" : "hover:border-primary/20"
      }`}
    >
      <div>
        <div
          className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300 ${
            isStudent ? "bg-emerald-50 text-emerald-600" : "bg-primary/5 text-primary"
          }`}
        >
          {icon}
        </div>
        <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-3">
          {title}
        </h2>
        <p className="text-slate-500 text-sm sm:text-base leading-relaxed mb-8">{blurb}</p>

        <ul className="space-y-3.5 mb-8 text-sm text-slate-600">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-3">
              <span
                className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isStudent ? "bg-emerald-50 text-emerald-600" : "bg-primary/5 text-primary"
                }`}
              >
                <Check className="w-3.5 h-3.5" />
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <span
        className={`w-full py-4 rounded-xl font-semibold shadow-md group-hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2 ${
          isStudent
            ? "bg-slate-900 text-white group-hover:bg-slate-800"
            : "bg-primary text-primary-foreground group-hover:opacity-90"
        }`}
      >
        {cta} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </span>
    </Link>
  );
}
