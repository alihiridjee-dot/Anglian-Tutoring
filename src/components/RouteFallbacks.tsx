import { useEffect } from "react";
import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Mascot } from "@/components/Doodles";
import { Spinner } from "@/components/Shared";
import { markHydrated } from "@/lib/auth/hydration";
import { isStaleBuildError, reloadForNewBuild } from "@/lib/platform/staleBuild";

/**
 * What a guarded route shows while it cannot show itself yet.
 *
 * `/_authenticated` and `/onboarding` both run with `ssr: false` — the server
 * has no session to check — so the server used to send an empty <body>, and
 * the student stared at a blank page until the client loaded and the guard
 * answered. This is what the server sends instead, and what shows on a client
 * navigation whose guard takes longer than the router's pending delay.
 */
export function RoutePending() {
  // An effect runs only once this boundary has hydrated, which is the moment a
  // guard may redirect away from it without a hydration mismatch.
  useEffect(markHydrated, []);
  return (
    <div className="page-aurora flex min-h-screen items-center justify-center px-4">
      <Spinner />
    </div>
  );
}

/**
 * A signed-in page that crashed, drawn inside the app rather than over it.
 *
 * With no boundary of its own, an error on any signed-in page climbed to the
 * root one, which replaces the whole document — navigation included — and
 * leaves "Try again" as the only way anywhere. Here the sidebar stays, so the
 * student can still reach every other page, and moving to one clears the
 * error. The copy and look are the root error page's, so both read as one.
 */
export function AuthedRouteError(props: ErrorComponentProps) {
  return (
    <AppLayout title="This page didn't load">
      <RouteErrorCard {...props} where="Signed-in" className="mt-6" />
    </AppLayout>
  );
}

/**
 * The card a guarded route's error page draws, in whichever frame it has: the
 * app's, or setup's (`/onboarding`). One card, so both get the same way out
 * and the same check for a page left open across a deploy.
 */
export function RouteErrorCard({
  error,
  reset,
  where,
  heading: Heading = "h2",
  className = "",
}: Pick<ErrorComponentProps, "error" | "reset"> & {
  /** Which part of the site, for the console. */
  where: string;
  /** `h1` where the frame has no title of its own. */
  heading?: "h1" | "h2";
  className?: string;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error(`${where} route error:`, error);
    // Its code was replaced by a deploy: "Try again" would fetch the same
    // missing file, so fetch the new build instead.
    if (isStaleBuildError(error)) reloadForNewBuild();
  }, [error, where]);

  return (
    <div className={`tint-rose pop-card mx-auto max-w-md p-5 text-center sm:p-8 ${className}`}>
      <Mascot name="flask" mood="wow" size={96} className="mx-auto" inheritTint />
      <Heading className="font-display mt-4 text-xl font-extrabold">
        This page didn&apos;t load
      </Heading>
      <p className="text-muted-foreground mt-2 text-sm font-medium">
        Something went wrong on our side, not yours.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
          className="btn-solid inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm"
        >
          Try again
        </button>
        <Link
          to="/dashboard"
          className="btn-soft inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
