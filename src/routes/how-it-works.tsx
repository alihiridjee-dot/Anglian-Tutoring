import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { Nav } from "@/components/landing/Nav";
import { Footer } from "@/components/landing/Footer";
import { FloatingWhatsApp } from "@/components/landing/FloatingWhatsApp";
import { ExplainerVideo } from "@/components/how-it-works/ExplainerVideo";
import { FeatureRoad, type RoadStop } from "@/components/how-it-works/FeatureRoad";
import { ForgettingCurve } from "@/components/how-it-works/ForgettingCurve";
import { RevisitSimulator } from "@/components/how-it-works/RevisitSimulator";
import {
  ChatMock,
  FeedbackMock,
  HomeworkMock,
  LiveMock,
  ProgrammeMock,
  QuizMock,
} from "@/components/how-it-works/ServicePreviews";
import { canonical } from "@/lib/platform/seo";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — Anglia Educate" },
      {
        name: "description",
        content:
          "Up to 3 live sessions a week, tasks marked by the tutor who taught it, a weekly quiz, a direct line to your tutor — and a spaced-repetition scheduler that brings every topic back just before your child would forget it.",
      },
    ],
    links: [canonical("/how-it-works")],
  }),
  component: HowItWorks,
});

// ---------------------------------------------------------------------------

/**
 * The six things a place actually buys, each shown as the card the student
 * will really open. The plan first, since everything else hangs off it; then
 * the week in order: taught, practised, tested, fed back, and a way to ask when
 * none of that was enough. They are the stops on the road (FeatureRoad).
 */
const SERVICES: RoadStop[] = [
  {
    id: "programme",
    emoji: "🗺️",
    sign: "Planned",
    tint: "tint-accent",
    title: "A course planned around your child",
    body: "We lay out the whole course on your child's exam board, from the week they join to their exam date. Each week shows what to learn, and which topics to revisit.",
    points: [
      "Set to their exam board, level and exam date",
      "Weak topics come back, based on their marked tasks and quizzes",
      "Reviewed and adjusted by Dr Nadia or Ali every week",
    ],
    preview: ProgrammeMock,
    wide: true,
  },
  {
    id: "live",
    emoji: "🎥",
    sign: "Taught live",
    tint: "tint-primary",
    title: "Up to 3 live sessions a week",
    body: "Small groups on Zoom, taught personally by Dr Nadia or Ali — a doctor and a medical student, never an agency tutor and never a recording standing in for a lesson. Your child is a name in the room, not a login.",
    points: [
      "Taught against your child's own exam board and spec points",
      "Every session recorded, so a missed week is recoverable",
      "Groups kept small enough that a quiet student can't hide",
    ],
    preview: LiveMock,
  },
  {
    id: "tasks",
    emoji: "✍️",
    sign: "Practised",
    tint: "tint-bio",
    title: "Tasks set, marked and returned",
    body: "Answered inside the platform on the spec points just taught, then marked by the tutor who taught them — so the feedback comes from someone who watched your child try it, not a marking service.",
    points: [
      "Returned with a grade, a percentage and personalised comments",
      "Written feedback that says what to do differently, not just what was wrong",
      "The mark feeds the schedule automatically — nothing to chase",
    ],
    preview: HomeworkMock,
  },
  {
    id: "quiz",
    emoji: "❓",
    sign: "Tested",
    tint: "tint-chem",
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
    id: "note",
    emoji: "💌",
    sign: "Fed back",
    tint: "tint-phys",
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
    id: "messages",
    emoji: "💬",
    sign: "Never stuck",
    tint: "tint-primary",
    title: "A direct line to their tutor, all week",
    body: "Stuck at nine on a Sunday? They message their tutor from inside the platform, with the spec point, task or quiz question already attached — so the answer that comes back is about the thing they're actually stuck on.",
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
    emoji: "📈",
    title: "A predicted grade that means something",
    desc: "Built from real marked work over time, not a one-off test. It moves when their work moves.",
  },
  {
    emoji: "👪",
    title: "Your own parent dashboard",
    desc: "A separate login: attendance, submissions, scores and progress — without having to ask them how it's going.",
  },
  {
    emoji: "📚",
    title: "Every board, every spec point",
    desc: "AQA, Edexcel and OCR, Separate Sciences or Combined Trilogy — and iGCSE. Tagged to the specification your child is sitting.",
  },
  {
    emoji: "🗓️",
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
    <div className="min-h-screen bg-secondary/40 text-foreground font-sans antialiased">
      <Nav />

      {/* ---------------- Hero ---------------- */}
      <section className="page-aurora relative overflow-hidden pt-(--site-bar-h)">
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
          {/* The homepage lays its copy over a full-bleed photo; this page hangs
              the photo beside the copy as a print, so the two heroes don't repeat.
              A phone on its side has no height for the whole column, so there
              the photo rises to meet the headline. */}
          <div className="grid items-center gap-12 split:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] split:gap-14 short:items-start">
            <div className="text-center split:text-left">
              <motion.h1
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: 0.08 }}
                className="font-display text-foreground text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl split:text-[clamp(2.25rem,3.6vw,3.25rem)]"
              >
                Your child isn&apos;t lazy.
                <br />
                {/* The page turns on this one line, so it gets the highlighter and
                    nothing else on the screen does. */}
                <span className="marker text-[var(--primary-deep)]">
                  They&apos;re just forgetting.
                </span>
              </motion.h1>

              <motion.p
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: 0.16 }}
                className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground split:mx-0"
              >
                Every parent has watched it happen. They revise a topic in October, swear they know
                it, and by the mock in February it's gone. That isn't a discipline problem — it's
                how memory works. So we built the tutoring around it.
              </motion.p>

              <motion.div
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: 0.24 }}
                className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap split:justify-start"
              >
                <Link
                  to="/auth"
                  search={{ mode: "signup" } as never}
                  className="btn-solid tint-primary inline-flex min-h-11 items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold whitespace-nowrap"
                >
                  Book your child's place <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/demo"
                  className="btn-soft tint-primary inline-flex min-h-11 items-center gap-1.5 rounded-xl px-6 py-3 text-sm whitespace-nowrap"
                >
                  <span aria-hidden>✨</span> Explore the platform
                </Link>
              </motion.div>
            </div>

            <motion.figure
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.2 }}
              className="mx-auto w-full max-w-2xl"
            >
              <div className="premium-card tint-primary relative rotate-[1.5deg] p-2 sm:p-2.5">
                <span aria-hidden className="preview-sticker">
                  🧠
                </span>
                <img
                  src="/how-it-works/student-laptop-1200.webp"
                  srcSet={[800, 1200, 1800]
                    .map((w) => `/how-it-works/student-laptop-${w}.webp ${w}w`)
                    .join(", ")}
                  sizes="(min-width: 64rem) 50vw, 100vw"
                  width={1800}
                  height={1200}
                  alt="A student at a laptop with the Anglia Educate student dashboard open"
                  fetchPriority="high"
                  className="aspect-[3/2] w-full rounded-[calc(var(--radius)-0.5rem)] object-cover"
                />
              </div>
            </motion.figure>
          </div>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.32 }}
            className="mx-auto mt-12 max-w-3xl"
          >
            <ExplainerVideo />
          </motion.div>
        </div>
      </section>

      {/* ---------------- What a place includes ---------------- */}
      <section className="bg-card py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Planned around your child, taught live and marked by Dr Nadia and Ali
            </h2>
          </motion.div>
        </div>

        <FeatureRoad stops={SERVICES} />

        {/* Everything else that comes with it, without another five sections. */}
        <div className="mx-auto mt-8 grid max-w-6xl gap-10 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {ALSO.map((f, i) => (
            <motion.div
              key={f.title}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: (i % 4) * 0.07 }}
              className="hiw-extra"
            >
              <span aria-hidden className="hiw-extra-emoji">
                {f.emoji}
              </span>
              <h3 className="font-display text-foreground mt-3 text-lg leading-snug font-extrabold">
                {f.title}
              </h3>
              <p className="text-muted-foreground mt-2 text-[0.97rem] leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------------- Try it ---------------- */}
      <section className="bg-secondary/60 py-20 lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Try the scheduler
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Play the part of your child for a moment. Answer a quiz, and watch the plan react in
              real time, using the same memory and weekly eligibility rules.
            </p>
          </motion.div>

          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }}>
            <RevisitSimulator />
          </motion.div>
        </div>
      </section>

      {/* ---------------- The forgetting curve ---------------- */}
      <section className="bg-card py-20 lg:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <motion.div {...fadeUp} className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
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

      {/* ---------------- Closing CTA ---------------- */}
      <section className="bg-secondary/40 py-20 lg:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <motion.div
            {...fadeUp}
            className="tint-pop relative rounded-[2rem] bg-[var(--primary-deep)] px-5 py-10 text-center text-white sm:px-14 sm:py-14"
          >
            <span aria-hidden className="preview-sticker" style={{ top: "-1.5rem", left: "8%" }}>
              🎓
            </span>
            <span
              aria-hidden
              className="preview-sticker"
              style={{ top: "36%", right: "-1.375rem", animationDelay: "-0.7s" }}
            >
              📈
            </span>
            <span
              aria-hidden
              className="preview-sticker"
              style={{ top: "auto", bottom: "-1.375rem", right: "9%", animationDelay: "-1.4s" }}
            >
              🧪
            </span>
            <h2 className="relative font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Give them a system, not just a tutor
            </h2>
            <p className="relative mx-auto mt-5 max-w-xl text-base leading-relaxed text-white">
              Small groups, a doctor and a medical student teaching every lesson personally, and a
              plan that keeps working between them.
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
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-7 py-3.5 text-sm font-bold text-white transition hover:bg-white/15"
              >
                <Check className="h-4 w-4" /> See pricing
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* The closing section's bg-secondary/40 over the page's own. */}
      <Footer seamFrom="color-mix(in srgb, var(--secondary) 64%, var(--background))" />
      <FloatingWhatsApp />
    </div>
  );
}
