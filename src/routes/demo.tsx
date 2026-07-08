import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { GraduationCap, Users, ArrowLeft, Loader2, Check, ArrowRight } from "lucide-react";
import { enterDemoMode } from "@/lib/demoAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Choose Demo | Anglian Learning" },
      {
        name: "description",
        content:
          "Explore the Anglian Learning platform with our interactive student and parent demo accounts.",
      },
    ],
  }),
  component: DemoPage,
});

function DemoPage() {
  const navigate = useNavigate();
  const [loadingRole, setLoadingRole] = useState<"student" | "parent" | null>(null);

  const handleDemoClick = async (role: "student" | "parent") => {
    setLoadingRole(role);
    toast.loading(`Opening interactive ${role} demo platform...`, { id: "demo-loading" });
    const success = await enterDemoMode(role);
    if (success) {
      toast.success(
        `Welcome to the Sandbox Demo! Previewing as ${role === "student" ? "Student" : "Parent"}.`,
        { id: "demo-loading" },
      );
      navigate({ to: role === "student" ? "/student-dashboard" : "/parent-dashboard" });
    } else {
      toast.error("Failed to start demo. Please try again.", { id: "demo-loading" });
    }
    setLoadingRole(null);
  };

  return (
    <div className="min-h-screen bg-white relative flex flex-col">
      {/* Top Header Navigation */}
      <div className="absolute top-6 left-6 z-10">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900 transition px-3 py-1.5 rounded-lg hover:bg-slate-50"
        >
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>
      </div>

      {/* Main split container */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 min-h-screen">
        {/* Left Half: Student Demo */}
        <div className="flex items-center justify-center p-6 sm:p-12 md:p-16 border-b md:border-b-0 md:border-r border-slate-100">
          <div
            onClick={() => handleDemoClick("student")}
            className="group max-w-md w-full bg-slate-50/50 hover:bg-slate-50/80 border border-slate-100 hover:border-emerald-200/60 rounded-3xl p-8 sm:p-10 shadow-xs hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col justify-between min-h-[460px]"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                <GraduationCap className="w-7 h-7" />
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-3">
                Student Demo
              </h2>
              <p className="text-slate-500 text-sm sm:text-base leading-relaxed mb-8">
                Experience the platform from a student's perspective. Participate in live lectures,
                attempt quizzes, and review your homework.
              </p>

              <ul className="space-y-3.5 mb-8 text-sm text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  <span>Attend live interactive lectures & ask questions</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  <span>Complete instant-feedback multiple choice quizzes</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  <span>Submit homework assignments & view grading feedback</span>
                </li>
              </ul>
            </div>

            <button
              disabled={loadingRole !== null}
              className="w-full py-4 rounded-xl font-semibold bg-slate-900 text-white hover:bg-slate-800 shadow-md group-hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loadingRole === "student" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Explore Student Platform{" "}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Half: Parent Demo */}
        <div className="flex items-center justify-center p-6 sm:p-12 md:p-16">
          <div
            onClick={() => handleDemoClick("parent")}
            className="group max-w-md w-full bg-slate-50/50 hover:bg-slate-50/80 border border-slate-100 hover:border-primary/20 rounded-3xl p-8 sm:p-10 shadow-xs hover:shadow-lg transition-all duration-300 cursor-pointer flex flex-col justify-between min-h-[460px]"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-primary/5 text-primary flex items-center justify-center mb-8 group-hover:scale-110 transition-transform duration-300">
                <Users className="w-7 h-7" />
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-3">
                Parent Demo
              </h2>
              <p className="text-slate-500 text-sm sm:text-base leading-relaxed mb-8">
                See how parents track their child's academic journey, monitor lesson attendance,
                check predicted grades, and reply directly to tutors.
              </p>

              <ul className="space-y-3.5 mb-8 text-sm text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/5 flex items-center justify-center text-primary flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  <span>Track GCSE predicted grades on a clean 1-9 scale</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/5 flex items-center justify-center text-primary flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  <span>Check live class attendance & quiz engagement</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/5 flex items-center justify-center text-primary flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  <span>Read feedback notes & directly reply to science tutors</span>
                </li>
              </ul>
            </div>

            <button
              disabled={loadingRole !== null}
              className="w-full py-4 rounded-xl font-semibold bg-primary text-primary-foreground hover:opacity-90 shadow-md group-hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loadingRole === "parent" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Explore Parent Platform{" "}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
