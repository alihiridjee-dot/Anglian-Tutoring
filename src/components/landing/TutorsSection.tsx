import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { GraduationCap, Award, Star, X, Send, MessageCircle } from "lucide-react";

// Shared WhatsApp number (same as the floating button). The pre-filled message
// names the tutor so we know who the enquiry is about.
const WA_NUMBER = "447530863009";

const TUTORS = [
  {
    id: "nadia",
    name: "Dr Nadia",
    role: "Head of Biology & Chemistry",
    degrees: [
      "BSc (Hons) Biomedical Sciences, Queen Mary University of London",
      "MBBS, Anglia Ruskin University",
    ],
    bio: "Practising NHS Doctor and science tutor of 5+ years, having taught students across the region to excellent GCSE results. Specialises in Biology and Chemistry.",
    fullBio: [
      "Dr Nadia brings real clinical experience straight from the NHS into the classroom, turning abstract biology and chemistry into the science she uses every day at work.",
      "Over 5+ years of tutoring, she has helped students across the region achieve excellent results — focusing on structured exam-board mark schemes and demystifying complex metabolic pathways.",
      "Her lessons build long-term memory retrieval systems that make science second nature, so students recall it under exam pressure.",
    ],
    badge: "GCSE Expert",
    color: "from-emerald-500/10 to-teal-500/20",
    accent: "text-emerald-600 bg-emerald-50 border-emerald-100",
    themeColor: "emerald",
    image: "/tutors/nadia.jpg",
    // See `avatarFocus` on the type below.
    avatarFocus: { size: "230%", position: "47% 30%" },
  },
  {
    id: "ali",
    name: "Ali",
    role: "Head of Physics & Maths",
    degrees: [
      "BSc (Merit) Synthetic Organic Chemistry & Biomedical Sciences, UCL",
      "MBChB, Anglia Ruskin University",
    ],
    bio: "UCL graduate now training as a doctor, and an expert across KS3, GCSE and A Level. Passionate about making science accessible and building strong problem-solving foundations.",
    fullBio: [
      "Ali graduated from UCL with a Merit in Synthetic Organic Chemistry & Biomedical Sciences and is now studying medicine on the MBChB programme at Anglia Ruskin University.",
      "Known for his highly dynamic, visual teaching style, he covers KS3, GCSE and A Level with equal depth — breaking down mechanics, electricity and chemistry into bite-sized mental models.",
      "With over 1,500 hours of 1-to-1 and small group online instruction, he specialises in building robust problem-solving frameworks.",
    ],
    badge: "KS3 · GCSE · A Level",
    color: "from-sky-500/10 to-indigo-500/20",
    accent: "text-sky-600 bg-sky-50 border-sky-100",
    themeColor: "sky",
    image: "/tutors/ali.jpg",
    avatarFocus: { size: "250%", position: "53% 55%" },
  },
];

export function TutorsSection() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeTutor = TUTORS.find((t) => t.id === activeId) ?? null;

  return (
    <section
      id="tutors"
      className="py-20 lg:py-24 bg-card border-t border-border relative overflow-visible"
    >
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Meet your expert tutors
          </h2>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Small team. Big results. Every lesson is taught personally by Dr Nadia or Ali — no
            rotating agency tutors. Tap a tutor to say hello and ask a question!
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-10 max-w-4xl mx-auto relative overflow-visible">
          {TUTORS.map((t) => {
            const isHovered = hoveredId === t.id;
            return (
              <div
                key={t.id}
                onMouseEnter={() => setHoveredId(t.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => setActiveId(t.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveId(t.id);
                  }
                }}
                className="group relative rounded-[2rem] border border-white/60 bg-white/70 backdrop-blur-xl p-8 pt-10 shadow-[0_8px_40px_-12px_rgba(15,23,42,0.15)] hover:shadow-[0_20px_60px_-16px_rgba(15,23,42,0.25)] transition duration-300 cursor-pointer overflow-hidden flex flex-col justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {/* Soft gradient tint wash */}
                <div
                  aria-hidden
                  className={`pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-gradient-to-br ${t.color} blur-3xl opacity-70`}
                />

                <div className="relative">
                  <div className="flex flex-col items-center text-center relative">
                    {/* Large circular tutor photo with gradient ring */}
                    <div className="relative shrink-0 mb-5">
                      <div
                        aria-hidden
                        className={`absolute -inset-1.5 rounded-full bg-gradient-to-br ${t.color} blur-md opacity-80`}
                      />
                      <motion.div
                        animate={{ scale: isHovered ? 1.04 : 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 22 }}
                        className="relative w-36 h-36 rounded-full p-1 bg-gradient-to-br from-card to-secondary shadow-lg ring-1 ring-white/80"
                      >
                        <div className="w-full h-full rounded-full overflow-hidden bg-secondary flex items-center justify-center text-primary font-display text-5xl font-extrabold">
                          {t.image ? (
                            <img
                              src={t.image}
                              alt={t.name}
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover [image-rendering:auto]"
                            />
                          ) : (
                            <span>{t.name === "Dr Nadia" ? "N" : t.name[0]}</span>
                          )}
                        </div>
                      </motion.div>
                      {/* Floating badge */}
                      <span
                        className={`absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap inline-flex items-center px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border shadow-sm backdrop-blur ${t.accent}`}
                      >
                        {t.badge}
                      </span>
                    </div>

                    <div className="w-full">
                      <h3 className="font-display text-2xl font-bold text-foreground">{t.name}</h3>
                      <p className="text-sm text-primary font-semibold mt-1">{t.role}</p>
                      <p className="mt-4 text-sm text-muted-foreground leading-relaxed font-medium">
                        {t.bio}
                      </p>

                      <span
                        className={`mt-5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition group-hover:scale-105 ${t.accent}`}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Chat with {t.name.replace("Dr ", "")}
                      </span>
                    </div>
                  </div>

                  {/* Animated Hover Credentials Bubble - Blends inside card */}
                  <div className="overflow-hidden">
                    <AnimatePresence initial={false}>
                      {isHovered && (
                        <motion.div
                          initial={{ height: 0, opacity: 0, marginTop: 0 }}
                          animate={{ height: "auto", opacity: 1, marginTop: 24 }}
                          exit={{ height: 0, opacity: 0, marginTop: 0 }}
                          transition={{ type: "spring", stiffness: 300, damping: 26 }}
                          className="border-t border-border/60 pt-5 space-y-4 text-left pointer-events-none"
                        >
                          <div className="flex items-start gap-3.5">
                            <div
                              className={`p-2 rounded-xl shrink-0 ${t.themeColor === "emerald" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}
                            >
                              <GraduationCap className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/70">
                                Verified Academic Degrees
                              </h4>
                              <ul className="mt-1.5 space-y-1.5">
                                {t.degrees.map((degree) => (
                                  <li
                                    key={degree}
                                    className="flex items-center gap-1.5 text-sm font-bold text-foreground"
                                  >
                                    <span aria-hidden className="text-xs">
                                      🎓
                                    </span>
                                    {degree}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>

                          <div className="flex items-start gap-3.5">
                            <div
                              className={`p-2 rounded-xl shrink-0 ${t.themeColor === "emerald" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}
                            >
                              <Award className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/70">
                                Teaching Strategy & Specialism
                              </h4>
                              <div className="mt-2 space-y-2.5">
                                {t.fullBio.map((para) => (
                                  <p
                                    key={para}
                                    className="text-xs text-muted-foreground leading-relaxed font-semibold"
                                  >
                                    {para}
                                  </p>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="pt-3 flex items-center gap-1 text-[10px] font-bold text-muted-foreground/70 border-t border-border">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <span className="ml-1 text-muted-foreground">
                              Syllabus-obsessed & Parent-approved
                            </span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {activeTutor && <TutorChatModal tutor={activeTutor} onClose={() => setActiveId(null)} />}
      </AnimatePresence>
    </section>
  );
}

type Tutor = (typeof TUTORS)[number];

function TutorChatModal({ tutor, onClose }: { tutor: Tutor; onClose: () => void }) {
  const [message, setMessage] = useState("");

  const firstName = tutor.name.replace("Dr ", "");
  const sendToWhatsApp = () => {
    const text =
      `Hi ${firstName}! I saw your profile on the Anglia Educate site.` +
      (message.trim() ? `\n\n${message.trim()}` : "");
    const url = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="pop-card pop-card-hero relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden sm:flex-row"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="icon-tile absolute top-4 right-4 z-20 size-9 bg-white/90 backdrop-blur transition hover:bg-white"
        >
          <X className="size-5" aria-hidden />
        </button>

        {/* Full-resolution photo */}
        <div className="sm:w-1/2 shrink-0 bg-secondary relative">
          <div
            aria-hidden
            className={`absolute inset-0 bg-gradient-to-br ${tutor.color} opacity-60`}
          />
          <img
            src={tutor.image}
            alt={tutor.name}
            referrerPolicy="no-referrer"
            className="relative w-full h-56 sm:h-full object-cover"
          />
        </div>

        {/* Chat side */}
        <div className="scroll-slim flex flex-col overflow-y-auto p-6 sm:w-1/2 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-foreground text-xl font-extrabold">{tutor.name}</h3>
            <span className="sticker stamp-in text-[10px] tracking-wider uppercase">
              {tutor.badge}
            </span>
          </div>
          <p className="text-primary mt-0.5 text-sm font-bold">{tutor.role}</p>

          {/* Greeting, drawn as a real message: the tutor's own face as the
              avatar and a bubble with a tail pointing at it. A bare grey box
              with no sender attached is what made this read as a form. */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 320, damping: 24 }}
            className="mt-5 flex items-end gap-2.5"
          >
            {/* Framing a face in a 36px circle needs a zoomed crop, and one
                shared crop cannot do it: Nadia's portrait is square (so
                `object-cover` never crops it at all, and the avatar came out as
                the whole photo shrunk to 36px) while Ali's is a portrait-
                oriented 3:4 with his face low and right of centre. Hence a
                focal point per tutor, alongside the image it belongs to. */}
            <span
              aria-hidden
              style={{
                backgroundImage: `url(${tutor.image})`,
                backgroundSize: tutor.avatarFocus.size,
                backgroundPosition: tutor.avatarFocus.position,
              }}
              className="size-9 shrink-0 rounded-full border-2 border-[color:var(--card)] bg-no-repeat shadow-[0_2px_0_0_color-mix(in_oklab,var(--tint)_30%,transparent)]"
            />
            <div className="surface-soft relative rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed font-medium">
              {/* The tail. Drawn as a rotated square tucked behind the bubble's
                  bottom-left corner so it inherits the same fill and border. */}
              <span
                aria-hidden
                className="absolute bottom-1.5 left-[-5px] size-3 rotate-45 rounded-[2px] border-b border-l border-[color:color-mix(in_oklab,var(--tint)_14%,var(--edge))] bg-[color:color-mix(in_oklab,var(--tint)_5%,var(--card))]"
              />
              <span className="relative">
                Hi! Nice to meet you 👋 I&apos;m {firstName}. Do you have any questions about
                tutoring? Ask away and I&apos;ll get straight back to you on WhatsApp.
              </span>
            </div>
          </motion.div>

          <div className="mt-4 flex-1 flex flex-col">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendToWhatsApp();
              }}
              autoFocus
              rows={4}
              placeholder={`Type your question for ${firstName}…`}
              className="pop-input w-full resize-none px-4 py-3 text-sm"
            />

            <button
              onClick={sendToWhatsApp}
              className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-[#128C7E] bg-[#25D366] px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_4px_0_0_#128C7E] transition-[transform,box-shadow,filter] hover:brightness-105 active:translate-y-[3px] active:shadow-[0_1px_0_0_#128C7E]"
            >
              <Send
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
              Send on WhatsApp
            </button>
            <p className="text-muted-foreground/70 mt-2.5 text-center text-[11px] font-medium">
              Opens WhatsApp with your message ready to send — no app? It works on web too.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
