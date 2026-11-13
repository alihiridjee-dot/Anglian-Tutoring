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
      <div className="absolute top-4 left-4 z-10 sm:top-6 sm:left-6">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-foreground transition px-3 py-1.5 rounded-lg hover:bg-secondary"
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
        <p className="max-w-xl text-foreground">
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

      <div className="relative z-10 mx-auto grid w-full max-w-4xl grid-cols-1 items-stretch gap-6 px-6 py-12 md:grid-cols-2 md:gap-8">
        <DemoCard
          to="/demo/student/dashboard"
          tint="tint-emerald"
          icon={<GraduationCap className="size-7" />}
          title="Student demo"
          blurb="Be Alex, a GCSE student taking Biology, Chemistry and Physics."
          points={[
            "A weekly plan that covers the whole course",
            "Quizzes that mark themselves and explain why",
            "Marked tasks, live Zoom lessons and messages",
          ]}
          cta="Explore as a student"
        />
        <DemoCard
          to="/demo/parent/dashboard"
          tint="tint-primary"
          icon={<Users className="size-7" />}
          title="Parent demo"
          blurb="See your child's progress, attendance and feedback in one place."
          points={[
            "Predicted 9–1 grades for each subject",
            "Quiz trends, attendance and tasks handed in",
            "Every comment the tutor writes",
          ]}
          cta="Explore as a parent"
        />
      </div>
    </div>
  );
}

function DemoCard({
  to,
  tint,
  icon,
  title,
  blurb,
  points,
  cta,
}: {
  to: string;
  tint: string;
  icon: React.ReactNode;
  title: string;
  blurb: string;
  points: string[];
  cta: string;
}) {
  return (
    <Link
      to={to}
      className={`${tint} premium-card premium-card-interactive group flex h-full flex-col p-7 sm:p-9`}
    >
      <span className="icon-tile size-14 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
        {icon}
      </span>
      <h2 className="mt-6 text-3xl font-extrabold">{title}</h2>
      <p className="mt-2 text-lg text-foreground">{blurb}</p>

      <ul className="mt-6 mb-8 space-y-3 text-base font-medium text-foreground">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-3">
            <span className="icon-tile icon-tile-solid mt-0.5 size-6 shrink-0 rounded-full">
              <Check className="size-3.5" strokeWidth={3} />
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ul>

      <span className="btn-solid mt-auto flex w-full items-center justify-center gap-2 rounded-xl py-4 text-lg">
        {cta} <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
