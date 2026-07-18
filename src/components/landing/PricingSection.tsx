import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { toast } from "sonner";

interface PricingSectionProps {
  selectedLevel: string;
  setSelectedLevel: (level: string) => void;
}

export function PricingSection({ selectedLevel, setSelectedLevel }: PricingSectionProps) {
  // Session maths throughout assumes 2 live sessions per week, i.e. 8 per month
  // (2 × 4 weeks) and 24 per tri-monthly term (8 × 3 months).
  const tiers = [
    {
      id: "weekly",
      name: "Weekly Plan",
      price: "£19.99",
      billing: "/ week",
      // 2 sessions → 19.99 / 2 = £10.00
      perSession: "£10.00 per session",
      highlight: false,
      badge: "Ideal flexibility",
    },
    {
      id: "monthly",
      name: "Monthly Saver",
      price: "£49.99",
      billing: "/ month",
      // 8 sessions → 49.99 / 8 = £6.25
      perSession: "£6.25 per session",
      highlight: true,
      badge: "Best Value Plan",
    },
    {
      id: "tri_monthly",
      name: "Tri-monthly",
      price: "£139.99",
      billing: "/ 3 months",
      // 24 sessions → 139.99 / 24 = £5.83
      perSession: "£5.83 per session",
      highlight: false,
      badge: "Premium Onboarding",
    },
  ];

  return (
    <section id="pricing" className="py-20 lg:py-24 bg-white border-t border-slate-100">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
            Simple, honest pricing
          </h2>
          <p className="mt-4 text-base text-slate-500 leading-relaxed">
            Pick a package that fits your learning pace. Cancel anytime.
          </p>

          {/* Prospective Client Study Level Selection Dropdown */}
          <div className="mt-8 inline-flex flex-col items-center bg-slate-50 border border-slate-200 p-4 rounded-2xl w-full max-w-md">
            <label
              htmlFor="level-dropdown"
              className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2"
            >
              Select student's current year/level
            </label>
            <div className="relative w-full">
              <select
                id="level-dropdown"
                value={selectedLevel}
                onChange={(e) => {
                  setSelectedLevel(e.target.value);
                  toast.success(
                    `Platform adjusted for ${e.target.value.replace("_", " ").toUpperCase()}!`,
                  );
                }}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer"
              >
                <option value="ks3">KS3 Science (Years 7, 8 & 9)</option>
                <option value="gcse_combined">GCSE Combined Trilogy Science</option>
                <option value="gcse_triple">
                  GCSE Triple Science (Biology, Chemistry & Physics)
                </option>
              </select>
              <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-400">
                ▼
              </div>
            </div>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {tiers.map((tier) => (
            <div
              key={tier.id}
              className={`relative rounded-2xl p-6.5 border flex flex-col justify-between transition-all duration-300 ${
                tier.highlight
                  ? "bg-gradient-to-br from-primary to-[var(--primary-deep)] text-primary-foreground border-primary shadow-xl shadow-primary/25 scale-[1.03]"
                  : "bg-white text-slate-900 border-slate-100 hover:border-primary/40 shadow-sm"
              }`}
            >
              {tier.badge && (
                <span
                  className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    tier.highlight
                      ? "bg-primary-foreground text-primary shadow-sm"
                      : "bg-slate-100 text-slate-700 border border-slate-200"
                  }`}
                >
                  {tier.badge}
                </span>
              )}

              <div>
                <h3 className="font-display text-xl font-bold mt-2">{tier.name}</h3>

                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight font-display">
                    {tier.price}
                  </span>
                  <span
                    className={`text-xs ${tier.highlight ? "text-white/75" : "text-slate-500"}`}
                  >
                    {tier.billing}
                  </span>
                </div>

                {/* Per Session Breakdown Box */}
                <div
                  className={`mt-3 py-1.5 px-3 rounded-lg text-xs font-semibold inline-block ${
                    tier.highlight
                      ? "bg-white/15 text-white"
                      : "bg-[var(--accent-soft)] text-[var(--primary-deep)]"
                  }`}
                >
                  Equivalent to <span className="underline font-bold">{tier.perSession}</span>
                </div>

                <div className="mt-6 border-t border-slate-100 pt-5 space-y-3.5 text-sm">
                  <p
                    className={`text-xs font-bold uppercase tracking-wider ${tier.highlight ? "text-white/70" : "text-slate-500"}`}
                  >
                    What's included (Customized for {selectedLevel.replace("_", " ").toUpperCase()}
                    ):
                  </p>

                  <ul className="space-y-2.5">
                    <li className="flex items-start gap-2.5">
                      <Check
                        className={`w-4 h-4 mt-0.5 shrink-0 ${tier.highlight ? "text-[var(--accent-soft)]" : "text-accent"}`}
                      />
                      <span>2 Weekly Live Science Lessons</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check
                        className={`w-4 h-4 mt-0.5 shrink-0 ${tier.highlight ? "text-[var(--accent-soft)]" : "text-accent"}`}
                      />
                      <span>Weekly Spec-Aligned Homework Marking</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check
                        className={`w-4 h-4 mt-0.5 shrink-0 ${tier.highlight ? "text-[var(--accent-soft)]" : "text-accent"}`}
                      />
                      <span>Weekly MCQ Quizzes & Tracker</span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check
                        className={`w-4 h-4 mt-0.5 shrink-0 ${tier.highlight ? "text-[var(--accent-soft)]" : "text-accent"}`}
                      />
                      <span>Grade Predictor & Parent Portal Access</span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="mt-8">
                <Link
                  to="/auth"
                  search={{ mode: "signup", tier: tier.id, level: selectedLevel } as never}
                  className={`block text-center w-full py-3 rounded-xl text-sm font-bold shadow-sm transition-all duration-200 ${
                    tier.highlight
                      ? "bg-primary-foreground text-primary hover:bg-white/90"
                      : "bg-primary text-primary-foreground hover:bg-[var(--primary-deep)]"
                  }`}
                >
                  Enrol student
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
