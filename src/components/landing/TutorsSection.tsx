const TUTORS = [
  {
    id: "nadia",
    name: "Nadia",
    role: "Head of Biology & Chemistry",
    bio: "10+ years teaching GCSE science, formerly Head of Science at a top UK independent school. Specialises in Biology and Chemistry.",
  },
  {
    id: "ali",
    name: "Ali",
    role: "Head of Physics & Maths",
    bio: "Physics graduate, Cambridge. Passionate about making Physics accessible and building strong problem-solving foundations.",
  },
];

export function TutorsSection() {
  return (
    <section id="tutors" className="py-20 lg:py-24 bg-white border-t border-slate-100">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
            Meet your expert tutors
          </h2>
          <p className="mt-4 text-base text-slate-500 leading-relaxed">
            Small team. Big results. Every lesson is taught personally by Nadia or Ali — no rotating
            agency tutors.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {TUTORS.map((t) => (
            <div
              key={t.id}
              className="relative rounded-2xl bg-slate-50 border border-slate-100 p-8 shadow-sm hover:shadow-md transition duration-300"
            >
              <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
                {/* Tutor Profile Initials Logo */}
                <div className="relative group/photo shrink-0">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-100 overflow-hidden flex items-center justify-center text-slate-800 font-display text-4xl font-extrabold shadow-inner relative">
                    <span>{t.name[0]}</span>
                  </div>
                </div>

                <div className="flex-1 text-center sm:text-left">
                  <h3 className="font-display text-2xl font-bold text-slate-900">{t.name}</h3>
                  <p className="text-sm text-slate-500 font-semibold mt-1">{t.role}</p>
                  <p className="mt-4 text-sm text-slate-600 leading-relaxed">{t.bio}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
