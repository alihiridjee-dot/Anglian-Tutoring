import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Check } from "lucide-react";

export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden py-20 lg:py-32 bg-gradient-to-b from-white to-slate-50/60"
    >
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_50rem_at_top,theme(colors.slate.100),white)] opacity-70" />
      <div className="max-w-4xl mx-auto px-6 text-center">
        <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Modern Science Platform for KS3 & GCSE
        </span>

        <h1 className="mt-8 font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 leading-[1.15] max-w-3xl mx-auto">
          Better grades in science, taught by teachers who care.
        </h1>

        <p className="mt-6 text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
          Weekly live lessons in Biology, Chemistry, and Physics, aligned to Edexcel, AQA, and OCR.
          Interactive quizzes, marked homework, and a grade predictor that actually reflects your
          progress.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Link
            to="/auth"
            search={{ mode: "signup" } as never}
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-slate-900 text-white font-semibold shadow-md hover:bg-slate-800 transition"
          >
            Get started <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="#pricing"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition"
          >
            View pricing
          </a>
        </div>

        <div className="mt-10 flex flex-wrap justify-center items-center gap-6 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" /> Cancel anytime
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" /> Spec-aligned classes
          </div>
        </div>
      </div>
    </section>
  );
}
