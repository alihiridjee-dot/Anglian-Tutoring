import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowRight, Heart } from "lucide-react";
import { Nav } from "@/components/landing/Nav";
import { Footer } from "@/components/landing/Footer";
import { FloatingWhatsApp } from "@/components/landing/FloatingWhatsApp";

export const Route = createFileRoute("/our-story")({
  head: () => ({
    meta: [
      { title: "Our story — Anglia Educate" },
      {
        name: "description",
        content:
          "Our tutoring grew through word of mouth. Anglia Educate is how we bring the same personal, high-quality teaching to more students.",
      },
    ],
  }),
  component: OurStory,
});

// The story in four beats, each with an emoji so the page reads as a journey.
const CHAPTERS = [
  {
    emoji: "🌱",
    title: "It started with word of mouth",
    body: "Our tutoring grew through word of mouth, with fantastic results, long waiting lists and more enquiries than we could accommodate. We didn’t want to turn students away, so we set out to find a way to deliver our approach to more students.",
  },
  {
    emoji: "🚀",
    title: "Then came Anglia Educate",
    body: "By developing our unique platform and team-based approach, we can support more students without compromising on quality — in fact, it means we can offer more support, more resources and more opportunities to every student.",
  },
  {
    emoji: "🤝",
    title: "So we built tutoring differently",
    body: "We brought together a small team of exceptional tutors, hand-selected for their expertise, teaching ability and commitment to their students.",
  },
  {
    emoji: "🎉",
    title: "The result?",
    body: "The personal, high-quality teaching that made our tutoring so successful — with even more behind it.",
  },
];

// Polaroid-style founder cards: tilted, with a sticker and a caption.
const FOUNDERS = [
  {
    name: "Dr Nadia",
    role: "Head of Biology & Chemistry",
    image: "/tutors/nadia.jpg",
    sticker: "🧬",
    tilt: -4,
  },
  {
    name: "Ali",
    role: "Head of Physics & Maths",
    image: "/tutors/ali.jpg",
    sticker: "⚛️",
    tilt: 4,
  },
];

const STATS = [
  { emoji: "📈", label: "Fantastic results" },
  { emoji: "⏳", label: "Long waiting lists" },
  { emoji: "💬", label: "Grown by word of mouth" },
  { emoji: "⭐", label: "Hand-selected tutors" },
];

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

function OurStory() {
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
          <motion.span {...fadeUp} className="sticker">
            <Heart className="size-3.5" aria-hidden /> Our story
          </motion.span>
          <motion.h1
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.08 }}
            className="font-display text-foreground mt-6 text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl lg:text-6xl"
          >
            Meet our <span className="marker text-[var(--primary-deep)]">founders!</span> 👋
          </motion.h1>
          <div className="mt-12 flex flex-col items-center justify-center gap-10 sm:flex-row sm:gap-6">
            {FOUNDERS.map((f, i) => (
              <motion.figure
                key={f.name}
                initial={{ opacity: 0, y: 30, rotate: 0 }}
                animate={{ opacity: 1, y: 0, rotate: f.tilt }}
                whileHover={{ rotate: 0, scale: 1.05, y: -6 }}
                transition={{ type: "spring", stiffness: 200, damping: 16, delay: 0.2 + i * 0.12 }}
                className="relative w-60 rounded-md bg-white p-3 pb-5 shadow-[0_20px_45px_-20px_rgba(6,78,90,0.55)]"
              >
                <span
                  aria-hidden
                  className="absolute -top-3 left-1/2 h-6 w-20 -translate-x-1/2 rotate-[-3deg] rounded-sm bg-[var(--pop)]/70"
                />
                <img
                  src={f.image}
                  alt={f.name}
                  className="aspect-square w-full rounded-sm object-cover"
                />
                <motion.span
                  aria-hidden
                  animate={{ rotate: [0, 12, -8, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.5, delay: i }}
                  className="absolute -right-4 -bottom-3 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card text-2xl shadow-md"
                >
                  {f.sticker}
                </motion.span>
                <figcaption className="mt-3 text-center">
                  <div className="font-display text-lg font-bold text-slate-900">{f.name}</div>
                  <div className="text-xs font-semibold text-slate-500">{f.role}</div>
                </figcaption>
              </motion.figure>
            ))}
          </div>
          <motion.p
            {...fadeUp}
            className="mt-8 text-2xl"
            aria-hidden
          >
            💚 ✏️ 🎓
          </motion.p>

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.16 }}
            className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-border bg-card/80 px-3 py-4 shadow-sm"
              >
                <div className="text-3xl" aria-hidden>
                  {s.emoji}
                </div>
                <div className="mt-2 text-sm font-semibold">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ---------------- Timeline ---------------- */}
      <section className="py-20 lg:py-24">
        <ol className="relative mx-auto max-w-3xl px-6">
          <div
            aria-hidden
            className="absolute top-2 bottom-2 left-[3.25rem] w-[3px] rounded-full bg-gradient-to-b from-[var(--accent-soft)] via-primary/40 to-[var(--pop)]"
          />
          {CHAPTERS.map((c, i) => (
            <motion.li
              key={c.title}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.05 }}
              className="relative mb-10 flex gap-6 last:mb-0"
            >
              <span
                aria-hidden
                className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-2xl shadow-sm"
              >
                {c.emoji}
              </span>
              <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <span className="eyebrow">Chapter {i + 1}</span>
                <h2 className="font-display mt-1 text-xl font-bold tracking-tight">{c.title}</h2>
                <p className="mt-3 leading-relaxed text-muted-foreground">{c.body}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </section>

      {/* ---------------- Closing CTA ---------------- */}
      <section className="pb-20 lg:pb-24">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div
            {...fadeUp}
            className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[var(--primary-deep)] to-primary px-8 py-14 text-center text-white shadow-[0_40px_90px_-40px_rgba(6,78,90,0.85)] sm:px-14"
          >
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Come and be part of the story ✨
            </h2>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/auth"
                search={{ mode: "signup" } as never}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-[var(--primary-deep)] shadow-lg transition hover:bg-white/90"
              >
                Book a place <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/"
                hash="tutors"
                className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-7 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Meet the tutors
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
      <FloatingWhatsApp />
    </div>
  );
}
