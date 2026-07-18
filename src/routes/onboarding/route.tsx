import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { GraduationCap, Check } from "lucide-react";
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

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="w-full max-w-2xl mx-auto">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-semibold tracking-tight">
            Anglian Learning
          </span>
        </div>

        <ol className="flex items-center gap-2 mb-8">
          {ONBOARDING_STEPS.map((step, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={step.path} className="flex-1">
                <div
                  className={`h-1.5 rounded-full transition-colors ${
                    done || active ? "bg-primary" : "bg-border"
                  }`}
                />
                <div className="mt-2 flex items-center gap-1.5">
                  {done ? (
                    <Check className="w-3 h-3 text-primary shrink-0" />
                  ) : (
                    <span
                      className={`w-3 h-3 rounded-full shrink-0 border ${
                        active ? "border-primary bg-primary/20" : "border-border"
                      }`}
                    />
                  )}
                  <span
                    className={`text-[11px] font-medium truncate ${
                      active ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        <Outlet />
      </div>
    </div>
  );
}
