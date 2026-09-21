import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { GraduationCap, Users, ArrowLeft, Check, ArrowRight, Compass } from "lucide-react";
import { startDemoTour } from "@/lib/demo/tourSteps";

export const Route = createFileRoute("/demo/")({
  head: () => ({
    meta: [
      { title: "Choose Demo | Anglia Educate" },
      {
        name: "description",
        content:
          "Explore the Anglia Educate platform with our interactive student and parent demos.",
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
  const navigate = useNavigate();
  return (
    <div className="page-aurora min-h-screen relative flex flex-col">
      <div className="absolute top-6 left-6 z-10">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition px-3 py-1.5 rounded-lg hover:bg-secondary"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>
      </div>

      {/* The quickest way in: the tour walks the student side and then the
          parent side, moving between pages on its own. */}
      <div className="relative z-10 flex flex-col items-center gap-3 px-6 pt-20 text-center">
        <p className="eyebrow">Interactive demo</p>
        <h1 className="font-display max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
          See how Anglia Educate works
        </h1>
        <p className="text-muted-foreground max-w-xl">
          Take the guided tour for a two-minute walk through everything, or pick a side and explore
          on your own.
        </p>
        <button
          type="button"
          onClick={() => {
            startDemoTour();
            void navigate({ to: "/demo/student/dashboard" });
          }}
          className="btn-solid mt-2 inline-flex items-center gap-2 rounded-xl px-5 py-3"
        >
          <Compass className="size-4" aria-hidden /> Take the guided tour
        </button>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2">
        <div className="flex items-center justify-center p-6 sm:p-12 md:p-16 border-b md:border-b-0 md:border-r border-border">
          <DemoCard
            to="/demo/student/dashboard"
            tone="student"
            icon={<GraduationCap className="w-7 h-7" />}
            title="Student Demo"
            blurb="See the platform as Alex, a GCSE student taking Biology, Chemistry and Physics, each with its own exam board."
            points={[
              "A weekly plan that covers the whole course before the exam",
              "Quizzes that mark themselves, with an explanation for every answer",
              "Homework answered online, marked with written feedback",
              "Live Zoom lessons and direct messages with the tutor",
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
            blurb="See what a parent sees: their child's progress, attendance and the tutor's feedback, all in one place."
            points={[
              "Predicted grades on the 9–1 scale for each subject",
              "Weekly quiz trends, lesson attendance and homework handed in",
              "Every comment the tutor writes on marked homework",
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
      className={`group max-w-md w-full bg-secondary/50 hover:bg-secondary/80 border border-border rounded-3xl p-8 sm:p-10 shadow-xs hover:shadow-lg transition-all duration-300 flex flex-col justify-between min-h-[460px] ${
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
        <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight mb-3">
          {title}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-8">{blurb}</p>

        <ul className="space-y-3.5 mb-8 text-sm text-muted-foreground">
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

      <span className="btn-solid flex w-full items-center justify-center gap-2 rounded-xl py-4 transition-all duration-200">
        {cta} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </span>
    </Link>
  );
}
