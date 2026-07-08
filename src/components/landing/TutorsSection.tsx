import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { GraduationCap, Award, BookOpen, Star } from "lucide-react";

const TUTORS = [
  {
    id: "nadia",
    name: "Dr Nadia",
    role: "Head of Biology & Chemistry",
    degrees:
      "PhD in Molecular Cell Biology (Imperial) • BSc (First Class Hons) in Biochemistry (UCL)",
    bio: "10+ years teaching GCSE science, formerly Head of Science at a top UK independent school. Specialises in Biology and Chemistry.",
    fullBio:
      "Dr Nadia is a highly respected educator who has guided hundreds of students to GCSE Grade 9s. She focuses on teaching structured exam-board mark schemes, demystifying complex metabolic pathways, and building long-term memory retrieval systems that make science second nature.",
    color: "from-emerald-500/10 to-teal-500/20",
    accent: "text-emerald-600 bg-emerald-50 border-emerald-100",
    themeColor: "emerald",
    image:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400&h=400",
  },
  {
    id: "ali",
    name: "Ali",
    role: "Head of Physics & Maths",
    degrees: "MSci (First Class Hons) in Physics (Imperial College London)",
    bio: "Physics graduate, Cambridge. Passionate about making Physics accessible and building strong problem-solving foundations.",
    fullBio:
      "Ali is known for his highly dynamic visual teaching style, breaking down mechanics and electricity into bite-sized mental models. Having completed over 1,500 hours of 1-to-1 and small group online GCSE instruction, he specializes in building robust problem-solving frameworks.",
    color: "from-sky-500/10 to-indigo-500/20",
    accent: "text-sky-600 bg-sky-50 border-sky-100",
    themeColor: "sky",
    image:
      "https://images.unsplash.com/photo-1618015358954-115ef1ed151b?auto=format&fit=crop&q=80&w=400&h=400",
  },
];

export function TutorsSection() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <section
      id="tutors"
      className="py-20 lg:py-24 bg-white border-t border-slate-100 relative overflow-visible"
    >
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
            Meet your expert tutors
          </h2>
          <p className="mt-4 text-base text-slate-500 leading-relaxed">
            Small team. Big results. Every lesson is taught personally by Dr Nadia or Ali — no
            rotating agency tutors. Hover over a tutor to explore credentials!
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
                className="relative rounded-3xl bg-slate-50 border border-slate-100 p-8 shadow-xs hover:shadow-md transition duration-300 cursor-pointer overflow-hidden flex flex-col justify-between"
              >
                <div>
                  <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start relative">
                    {/* Tutor Profile Initials Logo */}
                    <div className="relative group/photo shrink-0">
                      <motion.div
                        animate={{ scale: isHovered ? 1.05 : 1 }}
                        className={`w-24 h-24 rounded-3xl bg-gradient-to-br ${t.color} border border-primary/15 overflow-hidden flex items-center justify-center text-primary font-display text-4xl font-extrabold shadow-inner relative`}
                      >
                        {t.image ? (
                          <img
                            src={t.image}
                            alt={t.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span>{t.name === "Dr Nadia" ? "N" : t.name[0]}</span>
                        )}
                      </motion.div>
                    </div>

                    <div className="flex-1 text-center sm:text-left">
                      <h3 className="font-display text-2xl font-bold text-slate-900 flex items-center justify-center sm:justify-start gap-2">
                        {t.name}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border ${t.accent}`}
                        >
                          GCSE Expert
                        </span>
                      </h3>
                      <p className="text-sm text-primary font-semibold mt-1">{t.role}</p>
                      <p className="mt-4 text-sm text-slate-600 leading-relaxed font-medium">
                        {t.bio}
                      </p>
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
                          className="border-t border-slate-200/60 pt-5 space-y-4 text-left pointer-events-none"
                        >
                          <div className="flex items-start gap-3.5">
                            <div
                              className={`p-2 rounded-xl shrink-0 ${t.themeColor === "emerald" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}
                            >
                              <GraduationCap className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                                Verified Academic Degrees
                              </h4>
                              <p className="text-sm font-bold text-slate-900 mt-1 leading-relaxed">
                                {t.degrees}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3.5">
                            <div
                              className={`p-2 rounded-xl shrink-0 ${t.themeColor === "emerald" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}
                            >
                              <Award className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                                Teaching Strategy & Specialism
                              </h4>
                              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed font-semibold">
                                {t.fullBio}
                              </p>
                            </div>
                          </div>

                          <div className="pt-3 flex items-center gap-1 text-[10px] font-bold text-slate-400 border-t border-slate-100">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <span className="ml-1 text-slate-500">
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
    </section>
  );
}
