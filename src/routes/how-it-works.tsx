import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  Brain,
  CalendarCheck,
  ClipboardCheck,
  Eye,
  LineChart,
  MessageCircle,
  Sparkles,
  Target,
  Video,
  BookOpen,
  Users,
  ArrowRight,
  Check,
} from "lucide-react";
import { Nav } from "@/components/landing/Nav";
import { Footer } from "@/components/landing/Footer";
import { FloatingWhatsApp } from "@/components/landing/FloatingWhatsApp";
import { ForgettingCurve } from "@/components/how-it-works/ForgettingCurve";
import { RevisitSimulator } from "@/components/how-it-works/RevisitSimulator";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — Anglian Learning" },
      {
        name: "description",
        content:
          "Most revision is forgotten within weeks. We use a proven spaced-repetition scheduler to bring every topic back at exactly the right moment — and show parents the proof. Here's how.",
      },
    ],
  }),
  component: HowItWorks,
});

// ---------------------------------------------------------------------------

const LOOP = [
  {
    icon: Video,
    step: "01",
    title: "They learn it live",
    desc: "A live lesson with Dr Nadia or Ali, taught against the exact spec points on your child's exam board. Recorded, so a missed week is never a lost week.",
  },
  {
    icon: ClipboardCheck,
    step: "02",
    title: "We find out what stuck",
    desc: "Marked homework, a weekly quiz, and a quick honest self-rating. Three angles on the same topic — because 'I understood it in the lesson' and 'I can do it in the exam' are very different things.",
  },
  {
    icon: CalendarCheck,
    step: "03",
    title: "It comes back at the right moment",
    desc: "Every topic gets its own return date, set just before your child would start to forget it. Strong topics drift further away. Weak ones come straight back. Nothing is left to chance — or to memory.",
  },
];

const ACCOUNTABILITY = [
  {
    icon: Target,
    title: "No more blank-page revision",
    desc: "Your child opens the platform to a short, specific list for the week — not a whole textbook and a vague intention. The hardest part of revising is deciding what to revise, and we've removed it.",
  },
  {
    icon: Eye,
    title: "Weak topics can't hide",
    desc: "Students naturally revise what they already enjoy. Our scheduler does the opposite: it pushes the shaky topics to the top and keeps them there until they're genuinely solid.",
  },
  {
    icon: LineChart,
    title: "Progress you can actually see",
    desc: "Your own parent login, with attendance, homework, quiz scores and a predicted grade that moves as the real evidence moves. Not a termly report — a live picture.",
  },
  {
    icon: MessageCircle,
    title: "A tutor who already knows",
    desc: "Because every score feeds the same system, Dr Nadia and Ali walk into each lesson already knowing which topics are slipping. Small group sizes mean they can act on it.",
  },
];

const INCLUDED = [
  {
    icon: Video,
    title: "Two live lessons a week, per subject",
    desc: "Small groups on Zoom, taught personally by Dr Nadia or Ali — never an agency tutor. Every session recorded.",
  },
  {
    icon: ClipboardCheck,
    title: "Homework set, marked and fed back",
    desc: "Submitted in the platform, returned with personalised feedback within 48 hours — and the mark feeds the schedule automatically.",
  },
  {
    icon: BookOpen,
    title: "Weekly quizzes on the right topics",
    desc: "Tutor-approved questions, tagged to the exact spec point, with instant explanations so a wrong answer teaches something.",
  },
  {
    icon: Brain,
    title: "The personalised revision planner",
    desc: "The scheduler on this page, running quietly in the background — turning every score into a plan for the week ahead.",
  },
  {
    icon: LineChart,
    title: "A predicted grade that means something",
    desc: "Built from real marked work over time, not a one-off test. It moves when their work moves.",
  },
  {
    icon: Users,
    title: "Your own parent dashboard",
    desc: "A separate login for you: attendance, submissions, scores and progress — without having to ask them how it's going.",
  },
  {
    icon: Sparkles,
    title: "Every board, every spec point",
    desc: "AQA, Edexcel and OCR, Separate Sciences or Combined Trilogy. Resources tagged to the specification your child is actually sitting.",
  },
  {
    icon: CalendarCheck,
    title: "Flexibility that suits you",
    desc: "Weekly, monthly or termly billing. Add or drop subjects as things change. Cancel anytime.",
  },
];

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

function HowItWorks() {
  return (
    <div className="min-h-screen bg-slate-50/40 text-slate-900 font-sans antialiased">
      <Nav />

      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden border-b border-slate-100 bg-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--accent-soft)_0%,transparent_60%)] opacity-70"
        />
        <div className="relative mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
          <motion.span
            {...fadeUp}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--primary-deep)] backdrop-blur"
          >
            <Brain className="h-3.5 w-3.5" /> How it works
          </motion.span>

          <motion.h1
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.08 }}
            className="mt-6 font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl"
          >
            Your child isn't lazy.
            <br />
            <span className="text-[var(--primary-deep)]">They're just forgetting.</span>
          </motion.h1>

          <motion.p
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.16 }}
            className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-500"
          >
            Every parent has watched it happen. They revise a topic in October, swear they know it,
            and by the mock in February it's gone. That isn't a discipline problem — it's how memory
            works. So we built the tutoring around it.
          </motion.p>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.24 }}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link
              to="/auth"
              search={{ mode: "signup" } as never}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
            >
              Book your child's place <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/demo"
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-6 py-3 text-sm font-semibold text-primary transition hover:bg-primary/10"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Explore the platform
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ---------------- The forgetting curve ---------------- */}
      <section className="border-b border-slate-100 bg-slate-50/60 py-20 lg:py-24">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              The problem with normal revision
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Most of a lesson is gone within a month
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-500">
              Memory fades on a predictable curve — and because it's predictable, it can be beaten.
              Bring a topic back just before it slips, and each time it sticks for longer. This is
              the same principle medical students use to hold thousands of facts through finals.
            </p>
          </motion.div>

          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }}>
            <ForgettingCurve />
          </motion.div>
        </div>
      </section>

      {/* ---------------- The loop ---------------- */}
      <section className="border-b border-slate-100 bg-white py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-14 max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              What we actually do
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              A loop that closes itself
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-500">
              Most tutoring stops when the lesson ends. Ours keeps working all week.
            </p>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-3">
            {LOOP.map((s, i) => {
              const Icon = s.icon;
              return (
                <motion.div
                  key={s.step}
                  {...fadeUp}
                  transition={{ ...fadeUp.transition, delay: i * 0.1 }}
                  className="relative rounded-3xl border border-slate-200/80 bg-white p-7 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.4)] transition hover:border-primary/30"
                >
                  <span className="font-display text-5xl font-bold text-slate-100">{s.step}</span>
                  <div className="mt-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-100 bg-[var(--accent-soft)]/60">
                    <Icon className="h-5 w-5 text-[var(--primary-deep)]" />
                  </div>
                  <h3 className="mt-5 font-display text-lg font-bold text-slate-900">{s.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-500">{s.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- Try it ---------------- */}
      <section className="border-b border-slate-100 bg-slate-50/60 py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-12 max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              See it for yourself
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Try the scheduler
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-500">
              Play the part of your child for a moment. Answer a quiz, and watch the plan react in
              real time — this is the live engine, not an animation.
            </p>
          </motion.div>

          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }}>
            <RevisitSimulator />
          </motion.div>

          <motion.p
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.2 }}
            className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-slate-400"
          >
            Under the bonnet this is <strong className="font-semibold text-slate-500">FSRS</strong>{" "}
            — a free, open, peer-reviewed scheduling algorithm built on decades of memory research
            and trained on well over a billion real study reviews. We didn't invent it. We did the
            harder part: wiring it to real marked homework, real quizzes and a real tutor, so it
            works for a fifteen-year-old who has better things to do.
          </motion.p>
        </div>
      </section>

      {/* ---------------- Accountability ---------------- */}
      <section className="border-b border-slate-100 bg-white py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-14 max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              For parents
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              The end of "I've done my revision"
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-500">
              The hardest part of supporting a GCSE student is not knowing whether the work is
              actually happening — or whether it's the work that matters. This is built to answer
              both, without you having to nag.
            </p>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-2">
            {ACCOUNTABILITY.map((a, i) => {
              const Icon = a.icon;
              return (
                <motion.div
                  key={a.title}
                  {...fadeUp}
                  transition={{ ...fadeUp.transition, delay: (i % 2) * 0.08 }}
                  className="flex gap-5 rounded-3xl border border-slate-200/80 bg-white p-7 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.4)] transition hover:border-primary/30"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-100 bg-[var(--accent-soft)]/60">
                    <Icon className="h-5 w-5 text-[var(--primary-deep)]" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-slate-900">{a.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500">{a.desc}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- What's included ---------------- */}
      <section className="border-b border-slate-100 bg-slate-50/60 py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-14 max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              What's included
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              It all comes in the one place
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-500">
              One membership. No add-ons, no premium tier, no paying extra for the bits that matter.
            </p>
          </motion.div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {INCLUDED.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  {...fadeUp}
                  transition={{ ...fadeUp.transition, delay: (i % 4) * 0.07 }}
                  className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm transition duration-300 hover:border-primary/40 hover:-translate-y-0.5"
                >
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-100 bg-slate-50">
                    <Icon className="h-5 w-5 text-slate-800" />
                  </div>
                  <h3 className="font-display text-[15px] font-bold leading-snug text-slate-900">
                    {f.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-500">{f.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- Closing CTA ---------------- */}
      <section className="bg-white py-20 lg:py-24">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div
            {...fadeUp}
            className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[var(--primary-deep)] to-primary px-8 py-14 text-center text-white shadow-[0_40px_90px_-40px_rgba(6,78,90,0.85)] sm:px-14"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-white/5 blur-3xl"
            />
            <h2 className="relative font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Give them a system, not just a tutor
            </h2>
            <p className="relative mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/80">
              Small groups, two practising medics teaching every lesson personally, and a plan that
              keeps working between them. Places are limited by design.
            </p>
            <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/auth"
                search={{ mode: "signup" } as never}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-[var(--primary-deep)] shadow-lg transition hover:bg-white/90"
              >
                Book a place <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/"
                hash="pricing"
                className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-7 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <Check className="h-4 w-4" /> See pricing
              </Link>
            </div>
            <p className="relative mt-6 text-xs text-white/60">
              Cancel anytime · AQA, Edexcel &amp; OCR · KS3 and GCSE
            </p>
          </motion.div>
        </div>
      </section>

      <Footer />
      <FloatingWhatsApp />
    </div>
  );
}
