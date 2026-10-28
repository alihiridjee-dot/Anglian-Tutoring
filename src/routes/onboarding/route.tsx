import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Check } from "lucide-react";
import { BrandMark } from "@/components/auth/AuthShell";
import { RouteErrorCard, RoutePending } from "@/components/RouteFallbacks";
import { getAuthSession } from "@/lib/auth/session";
import { whenHydrated } from "@/lib/auth/hydration";
import { loadGuardState } from "@/lib/auth/guardState";
import { UserRole } from "@/types/user";
import { ONBOARDING_STEPS, stepIndex } from "@/lib/auth/onboarding";
import { useSignOut } from "@/hooks/useSignOut";

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
  beforeLoad: async ({ location, context }) => {
    // First, because everything below can redirect — see `@/lib/auth/hydration`.
    await whenHydrated();

    const session = await getAuthSession();
    if (!session.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } as never });
    }

    // The same cached answer /_authenticated acts on. Asked separately here —
    // a profile read and the access RPC, on every "Continue" — the two guards
    // could disagree for a moment, and each sends the student to the other.
    const viewer = await loadGuardState(context.queryClient, session.user.id);

    // Setup is a student flow. Parents and tutors have no board, no subjects
    // and nothing to buy for themselves, so send them to their own landing.
    if (viewer.appRole !== UserRole.STUDENT) {
      throw redirect({ to: "/dashboard" });
    }

    // Nothing left to set up or pay for — don't make a paying student sit
    // through setup again just because they typed the URL. Only a definite
    // yes to both moves anybody: `null` is "couldn't tell", and they stay.
    if (viewer.hasAccess === true && viewer.onboardingComplete === true) {
      throw redirect({ to: "/dashboard" });
    }

    return { session, viewer };
  },
  // No server render here either: show the loading state, not an empty body.
  pendingComponent: RoutePending,
  errorComponent: OnboardingError,
  component: OnboardingLayout,
});

function OnboardingLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = stepIndex(pathname);
  const signOut = useSignOut();

  const total = ONBOARDING_STEPS.length;
  const pct = Math.round(((current + 1) / total) * 100);

  return (
    <div className="auth-aurora min-h-screen px-4 py-8 sm:py-12">
      <div className="w-full max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <BrandMark />
          <span className="chip tabular-nums">
            Step {Math.min(current + 1, total)} of {total}
          </span>
        </div>

        {/* One continuous track with a gradient fill, rather than one bar per
            step — it reads as progress through a single flow instead of five
            unrelated segments. Labels sit under their own slice. */}
        <div className="mb-8 rise-in">
          <div className="bg-secondary h-2.5 overflow-hidden rounded-full border-[1.5px] border-[color:color-mix(in_oklab,var(--tint)_22%,var(--edge))]">
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
                <li
                  key={step.path}
                  // Five labels do not fit a phone: the active step takes the
                  // row and the others shrink to their dot until `sm`.
                  className={`flex items-center gap-1.5 min-w-0 ${
                    active ? "flex-1" : "flex-none sm:flex-1"
                  }`}
                >
                  {done ? (
                    <span className="bg-primary text-primary-foreground pop-in flex size-4 shrink-0 items-center justify-center rounded-full">
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                  ) : (
                    <span
                      className={`size-4 shrink-0 rounded-full border-2 ${
                        active ? "border-primary bg-primary/20" : "border-border"
                      }`}
                    />
                  )}
                  <span
                    className={`truncate text-[11px] ${
                      active ? "text-foreground font-bold" : "text-muted-foreground max-sm:sr-only"
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

        {/* A way out from the first step: someone who signed up as the wrong
            person (a parent on the Student tab) can't leave any other way, as
            /auth sends a signed-in visitor straight back here. The plan step
            has its own Sign out beside its Back link. */}
        {!pathname.startsWith("/onboarding/plan") && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={signOut}
              className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground sm:pointer-fine:min-h-0"
            >
              Not you? Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A setup step that crashed.
 *
 * With no boundary of its own, a crash here (where payment happens) climbed to
 * the root error page, whose only button is Try again. This is the signed-in
 * pages' error card, in setup's own frame, with the same way out: the
 * dashboard, which sends a student who isn't set up yet back to the first step.
 */
function OnboardingError(props: ErrorComponentProps) {
  return (
    <div className="auth-aurora min-h-screen px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8">
          <BrandMark />
        </div>
        <RouteErrorCard {...props} where="Onboarding" heading="h1" />
      </div>
    </div>
  );
}
