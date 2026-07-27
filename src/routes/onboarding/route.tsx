import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { BrandMark } from "@/components/auth/AuthShell";
import { getAuthSession } from "@/lib/auth/session";
import { supabase } from "@/integrations/supabase/client";
import { ONBOARDING_STEPS, stepIndex } from "@/lib/onboarding";

/**
 * Profile setup + payment, for students who have verified their email but do
 * not yet have access.
 *
 * This deliberately sits OUTSIDE /_authenticated. That guard bounces students
 * who haven't finished setup or paid *to here* — so if these pages lived under
 * it, the redirect would point at itself and the student would be trapped in a
 * loop with no way to give us money. A session is still required; access is not.
 */
export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const session = await getAuthSession();
    if (!session.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } as never });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .maybeSingle();

    // Setup is a student flow. Parents and tutors have no board, no subjects
    // and nothing to buy for themselves, so send them to their own landing.
    if (profile && profile.role !== "student") {
      throw redirect({ to: "/dashboard" });
    }

    // Nothing left to set up or pay for — don't make a paying student sit
    // through setup again just because they typed the URL.
    const { data: access } = await supabase.rpc("my_access_state").single();
    if (access?.has_access && access?.onboarding_complete) {
      throw redirect({ to: "/dashboard" });
    }

    return { session };
  },
  component: OnboardingLayout,
});

function OnboardingLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = stepIndex(pathname);

  const total = ONBOARDING_STEPS.length;
  const pct = Math.round(((current + 1) / total) * 100);

  return (
    <div className="auth-aurora min-h-screen px-4 py-8 sm:py-12">
      <div className="w-full max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <BrandMark />
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">
            Step {Math.min(current + 1, total)} of {total}
          </span>
        </div>

        {/* One continuous track with a gradient fill, rather than one bar per
            step — it reads as progress through a single flow instead of six
            unrelated segments. Labels sit under their own slice. */}
        <div className="mb-8 rise-in">
          <div className="h-2 rounded-full bg-secondary overflow-hidden border border-border/60">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%`, background: "var(--gradient-hero)" }}
            />
          </div>
          <ol className="mt-3 flex items-start gap-2">
            {ONBOARDING_STEPS.map((step, i) => {
              const done = i < current;
              const active = i === current;
              return (
                <li key={step.path} className="flex-1 flex items-center gap-1.5 min-w-0">
                  {done ? (
                    <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                      <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    </span>
                  ) : (
                    <span
                      className={`w-4 h-4 rounded-full shrink-0 border-2 ${
                        active ? "border-primary bg-primary/20" : "border-border"
                      }`}
                    />
                  )}
                  <span
                    className={`text-[11px] truncate ${
                      active ? "font-semibold text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <Outlet />
      </div>
    </div>
  );
}
