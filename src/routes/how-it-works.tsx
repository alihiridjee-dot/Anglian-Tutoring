import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  Brain,
  CalendarCheck,
  ClipboardCheck,
  Eye,
  LineChart,
  ListChecks,
  MessageCircle,
  PenLine,
  Sparkles,
  Target,
  Video,
  Users,
  ArrowRight,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Nav } from "@/components/landing/Nav";
import { Footer } from "@/components/landing/Footer";
import { FloatingWhatsApp } from "@/components/landing/FloatingWhatsApp";
import { ForgettingCurve } from "@/components/how-it-works/ForgettingCurve";
import { RevisitSimulator } from "@/components/how-it-works/RevisitSimulator";
import { MemoryEngine } from "@/components/how-it-works/MemoryEngine";
import { TypicalWeek } from "@/components/how-it-works/TypicalWeek";
import {
  ChatMock,
  FeedbackMock,
  HomeworkMock,
  LiveMock,
  QuizMock,
} from "@/components/how-it-works/ServicePreviews";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — Anglia Educate" },
      {
        name: "description",
        content:
          "Two live lessons a week, homework marked by the tutor who taught it, a weekly quiz, a direct line to your tutor — and a spaced-repetition scheduler that brings every topic back just before your child would forget it.",
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

/**
 * The five things a place actually buys, each shown as the card the student
 * will really open. Ordered the way the week runs: taught, practised, tested,
 * fed back, and a way to ask when none of that was enough.
 */
interface Service {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  preview: () => React.JSX.Element;
}

const SERVICES: Service[] = [
  {
    icon: Video,
    eyebrow: "Taught live",
    title: "Two live lessons a week, per subject",
    body: "Small groups on Zoom, taught personally by Dr Nadia or Ali — two practising medics, never an agency tutor and never a recording standing in for a lesson. Your child is a name in the room, not a login.",
    points: [
      "Taught against your child's own exam board and spec points",
      "Every session recorded, so a missed week is recoverable",
      "Groups kept small enough that a quiet student can't hide",
    ],
    preview: LiveMock,
  },
  {
    icon: ClipboardCheck,
    eyebrow: "Practised",
    title: "Homework set, marked and returned",
    body: "Answered inside the platform on the spec points just taught, then marked by the tutor who taught them — so the feedback comes from someone who watched your child try it, not a marking service.",
    points: [
      "Returned with a grade, a percentage and personalised comments",
      "Written feedback that says what to do differently, not just what was wrong",
      "The mark feeds the schedule automatically — nothing to chase",
    ],
    preview: HomeworkMock,
  },
  {
    icon: ListChecks,
    eyebrow: "Tested",
    title: "A weekly quiz on the right topics",
    body: "Every week, a short quiz built from the spec points your child has actually covered — tutor-approved, tagged question by question, and marked the moment they finish.",
    points: [
      "Every question tagged to a specific spec point",
      "Instant explanations, so a wrong answer teaches something",
      "Scores feed straight into what comes back next week",
    ],
    preview: QuizMock,
  },
  {
    icon: PenLine,
    eyebrow: "Fed back",
    title: "A tutor who tells you what they're seeing",
    body: "Not a termly report. Each week your child gets a note from their tutor about their week specifically — what has clicked, what is still leaking marks, and what the two of them are doing about it next.",
    points: [
      "Written by the tutor, about your child, every week",
      "Points at named spec points, not vague encouragement",
      "Visible to you in the parent dashboard as it happens",
    ],
    preview: FeedbackMock,
  },
  {
    icon: MessageCircle,
    eyebrow: "Never stuck",
    title: "A direct line to their tutor, all week",
    body: "Stuck at nine on a Sunday? They message their tutor from inside the platform, with the spec point, homework or quiz question already attached — so the answer that comes back is about the thing they're actually stuck on.",
    points: [
      "Questions pinned to the exact topic they came from",
      "Answered by their tutor — never auto-replied by a bot",
      "No app to install, no phone number to share",
    ],
    preview: ChatMock,
  },
];

const ALSO = [
  {
    icon: LineChart,
    title: "A predicted grade that means something",
    desc: "Built from real marked work over time, not a one-off test. It moves when their work moves.",
  },
  {
    icon: Users,
    title: "Your own parent dashboard",
    desc: "A separate login: attendance, submissions, scores and progress — without having to ask them how it's going.",
  },
  {
    icon: Sparkles,
    title: "Every board, every spec point",
    desc: "AQA, Edexcel and OCR, Separate Sciences or Combined Trilogy — and iGCSE. Tagged to the specification your child is sitting.",
  },
  {
    icon: CalendarCheck,
    title: "Flexibility that suits you",
    desc: "Weekly, monthly or termly billing. Add or drop subjects as things change. Cancel anytime.",
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

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

function HowItWorks() {
  return (
    <div className="min-h-screen bg-secondary/40 text-foreground font-sans antialiased">
      <Nav />

      {/* ---------------- Hero ---------------- */}
      <section className="page-aurora relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--accent-soft)_0%,transparent_60%)] opacity-70"
        />
        <div className="relative mx-auto max-w-4xl px-6 py-20 text-center lg:py-28">
          <motion.span
            {...fadeUp}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--primary-deep)] backdrop-blur"
          >
            <Brain className="h-3.5 w-3.5" /> How it works
          </motion.span>

          <motion.h1
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.08 }}
            className="mt-6 font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl"
          >
            Your child isn't lazy.
            <br />
            <span className="text-[var(--primary-deep)]">They're just forgetting.</span>
          </motion.h1>

          <motion.p
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.16 }}
            className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground"
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
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-sm transition "
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
      <section className="border-b border-border bg-secondary/60 py-20 lg:py-24">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-12 max-w-2xl text-center">
            <span className="eyebrow">The problem with normal revision</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Most of a lesson is gone within a month
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
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
      <section className="border-b border-border bg-card py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-14 max-w-2xl text-center">
            <span className="eyebrow">What we actually do</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              A loop that closes itself
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
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
                  className="premium-card premium-card-interactive relative rounded-3xl p-7"
                >
                  <span className="font-display text-5xl font-bold text-primary/15">{s.step}</span>
                  <div className="mt-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-[var(--accent-soft)]/60">
                    <Icon className="h-5 w-5 text-[var(--primary-deep)]" />
                  </div>
                  <h3 className="mt-5 font-display text-lg font-bold text-foreground">{s.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- A week, in full ---------------- */}
      <section className="border-b border-border bg-secondary/60 py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-12 max-w-2xl text-center">
            <span className="eyebrow">What a place actually buys</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Their week has a shape to it
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Not two hours of Zoom and a folder of PDFs. Something arrives, is looked at by a
              person, and comes back — every week, on a rhythm your child can feel.
            </p>
          </motion.div>

          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.08 }}>
            <TypicalWeek />
          </motion.div>
        </div>
      </section>

      {/* ---------------- The five services ---------------- */}
      <section className="border-b border-border bg-card py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-16 max-w-2xl text-center">
            <span className="eyebrow">Included, every week</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Five things, and a person behind each one
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              One membership — no add-ons, no premium tier, no paying extra for the bits that
              matter. Here is exactly what your child gets, shown as they'll actually see it.
            </p>
          </motion.div>

          <div className="space-y-14 lg:space-y-20">
            {SERVICES.map((s, i) => {
              const Icon = s.icon;
              const Preview = s.preview;
              const flip = i % 2 === 1;
              return (
                <motion.div
                  key={s.title}
                  {...fadeUp}
                  className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14"
                >
                  <div className={flip ? "lg:order-2" : undefined}>
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-[var(--accent-soft)]/60">
                        <Icon className="h-5 w-5 text-[var(--primary-deep)]" />
                      </span>
                      <span className="eyebrow">{s.eyebrow}</span>
                    </div>
                    <h3 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-[28px]">
                      {s.title}
                    </h3>
                    <p className="mt-4 text-base leading-relaxed text-muted-foreground">{s.body}</p>
                    <ul className="mt-5 space-y-2.5">
                      {s.points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-sm text-foreground/90">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* The mock, floated on a soft tint so it reads as a screen. */}
                  <div className={flip ? "lg:order-1" : undefined}>
                    <div className="relative rounded-3xl border border-border bg-secondary/60 p-5 sm:p-8">
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(ellipse_at_top_left,_var(--accent-soft)_0%,transparent_65%)] opacity-70"
                      />
                      <div className="relative mx-auto max-w-sm">
                        <Preview />
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Everything else that comes with it, without another five sections. */}
          <div className="mt-16 grid gap-5 border-t border-border pt-14 sm:grid-cols-2 lg:grid-cols-4">
            {ALSO.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  {...fadeUp}
                  transition={{ ...fadeUp.transition, delay: (i % 4) * 0.07 }}
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-secondary">
                    <Icon className="h-4.5 w-4.5 text-foreground" />
                  </div>
                  <h3 className="font-display text-[15px] font-bold leading-snug text-foreground">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- The engine ---------------- */}
      <section className="border-b border-border bg-secondary/60 py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-12 max-w-2xl text-center">
            <span className="eyebrow">The part that runs all week</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              A plan built for your child, not for a class
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Everything on this page feeds one thing: a schedule that knows which topics{" "}
              <em>your</em> child is shaky on, and brings each one back at its own moment. Two
              students in the same lesson get different weeks — because they are different students.
            </p>
          </motion.div>

          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.08 }}>
            <MemoryEngine />
          </motion.div>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.16 }}
            className="mx-auto mt-10 max-w-3xl rounded-3xl border border-border bg-card p-7 sm:p-9"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-[var(--accent-soft)]/60">
                <Brain className="h-5 w-5 text-[var(--primary-deep)]" />
              </span>
              <div>
                <span className="eyebrow">The technology</span>
                <p className="font-display text-lg font-bold leading-tight text-foreground">
                  It's called FSRS, and we didn't invent it
                </p>
              </div>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              <strong className="font-semibold text-foreground">
                FSRS — the Free Spaced Repetition Scheduler
              </strong>{" "}
              is a free, open, peer-reviewed algorithm built on decades of memory research and
              trained on well over a billion real study reviews. It's what serious medical students
              use to hold thousands of facts through finals. For each topic it keeps two numbers:
              how likely your child is to recall it <em>today</em>, and how durable that memory has
              become. Every mark, score and self-rating updates both.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              We did the harder part: wiring it to real marked homework, real quizzes and a real
              tutor, so it works for a fifteen-year-old who has better things to do. The algorithm
              picks the moment. A person still picks what's worth learning — and still writes the
              sentence that explains it.
            </p>
            <p className="mt-4 rounded-xl bg-secondary/70 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
              <strong className="font-semibold text-foreground">In plain English:</strong> your
              child never has to decide what to revise, and never revises something they already
              know while something they don't quietly rots.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ---------------- Try it ---------------- */}
      <section className="border-b border-border bg-card py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-12 max-w-2xl text-center">
            <span className="eyebrow">See it for yourself</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Try the scheduler
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Play the part of your child for a moment. Answer a quiz, and watch the plan react in
              real time — this is the live engine, not an animation.
            </p>
          </motion.div>

          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }}>
            <RevisitSimulator />
          </motion.div>
        </div>
      </section>

      {/* ---------------- The people ---------------- */}
      <section className="border-b border-border bg-secondary/60 py-20 lg:py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <motion.div {...fadeUp}>
            <span className="eyebrow">Who's actually teaching</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              The same two people, every week
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Every lesson is taught by Dr Nadia or Ali. Every piece of homework is marked by
              whichever of them taught it. Every message is answered by the person your child sat
              with on Tuesday. There is no pool of tutors behind this, no marking service, and no
              chatbot wearing someone's name — which is the whole reason the feedback is worth
              reading.
            </p>
          </motion.div>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.1 }}
            className="mt-10 grid gap-5 sm:grid-cols-3"
          >
            {[
              {
                stat: "2",
                label: "tutors, and only two",
                note: "Both practising medics. Both teach every week.",
              },
              {
                stat: "48h",
                label: "to marked and back",
                note: "With comments written for your child specifically.",
              },
              {
                stat: "1",
                label: "plan per student",
                note: "Rebuilt weekly from their own evidence.",
              },
            ].map((s) => (
              <div key={s.label} className="premium-card rounded-2xl p-6">
                <div className="font-display text-3xl font-bold text-[var(--primary-deep)]">
                  {s.stat}
                </div>
                <div className="mt-1 text-sm font-bold text-foreground">{s.label}</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.note}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ---------------- Accountability ---------------- */}
      <section className="border-b border-border bg-card py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6">
          <motion.div {...fadeUp} className="mx-auto mb-14 max-w-2xl text-center">
            <span className="eyebrow">For parents</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              The end of "I've done my revision"
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
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
                  className="premium-card premium-card-interactive flex gap-5 rounded-3xl p-7"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-[var(--accent-soft)]/60">
                    <Icon className="h-5 w-5 text-[var(--primary-deep)]" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-foreground">{a.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{a.desc}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------- Closing CTA ---------------- */}
      <section className="bg-secondary/40 py-20 lg:py-24">
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
              Cancel anytime · AQA, Edexcel &amp; OCR · KS3, GCSE and iGCSE
            </p>
          </motion.div>
        </div>
      </section>

      <Footer />
      <FloatingWhatsApp />
    </div>
  );
}
