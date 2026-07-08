import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, Check } from "lucide-react";

export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden py-20 lg:py-32 bg-gradient-to-b from-white to-slate-50/60"
    >
      {/* Background with faded science images reflecting the specialities */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        {/* Radial gradient overlay for smooth edges and text contrast */}
        <div className="absolute inset-0 bg-[radial-gradient(45rem_50rem_at_top,theme(colors.slate.100),white)] opacity-90 z-10" />

        {/* Subtle, beautiful faded background images reflecting lab / physics / astronomy */}
        <div className="absolute inset-0 opacity-[0.09] z-0">
          <img
            src="https://images.unsplash.com/photo-1532187863486-abf9d39d66e8?auto=format&fit=crop&w=1600&q=80"
            alt="Chemistry Laboratory"
            className="w-1/2 h-full object-cover absolute left-0 top-0 select-none pointer-events-none filter blur-[2px]"
            referrerPolicy="no-referrer"
          />
          <img
            src="https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&w=1600&q=80"
            alt="Physics & Light Equations"
            className="w-1/2 h-full object-cover absolute right-0 top-0 select-none pointer-events-none filter blur-[2px]"
            referrerPolicy="no-referrer"
          />
          {/* Blend gradient down the center */}
          <div className="absolute inset-y-0 left-1/3 right-1/3 bg-gradient-to-r from-transparent via-white to-transparent" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 text-center relative z-20">
        <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-slate-100/90 text-slate-800 border border-slate-200 backdrop-blur-xs">
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
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-slate-900 text-white font-semibold shadow-md hover:bg-slate-800 transition cursor-pointer"
          >
            Get started <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/demo"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl border border-primary/20 bg-primary/5 font-semibold text-primary hover:bg-primary/10 shadow-sm transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            Try Demo Platform
          </Link>
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
