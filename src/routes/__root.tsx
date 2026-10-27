import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode, createElement } from "react";

import appCss from "../styles.css?url";
import { supabase } from "@/integrations/supabase/client";
import { Mascot } from "@/components/Doodles";
import { markHydrated } from "@/lib/auth/hydration";
import { createAuthChangeHandler } from "@/lib/auth/authChange";
import { installReturnSpots } from "@/lib/shell/returnSpot";
import { SITE_URL } from "@/lib/platform/seo";

function NotFoundComponent() {
  return (
    <div className="page-aurora flex min-h-screen items-center justify-center px-4">
      <div className="pop-card pop-card-hero max-w-md p-8 text-center">
        <Mascot name="rocket" mood="wow" size={104} className="mx-auto" />
        <p className="numeral mt-4 text-6xl text-[color:var(--tint)]">404</p>
        <h1 className="font-display mt-2 text-xl font-extrabold">
          Nothing here — wrong turn somewhere
        </h1>
        <Link to="/" className="btn-hero mt-6 inline-flex rounded-xl px-6 py-3 text-sm">
          Back to home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error("Root Error Component caught:", error);
  }, [error]);

  return (
    <div className="page-aurora flex min-h-screen items-center justify-center px-4">
      <div className="tint-rose pop-card pop-card-hero max-w-md p-8 text-center">
        <Mascot name="flask" mood="wow" size={96} className="mx-auto" inheritTint />
        <h1 className="font-display mt-4 text-xl font-extrabold">This page didn&apos;t load</h1>
        <p className="text-muted-foreground mt-2 text-sm font-medium">
          Something went wrong on our side, not yours.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn-solid inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

const ORGANIZATION_LD = {
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  name: "Anglia Educate",
  url: SITE_URL,
  logo: `${SITE_URL}/apple-touch-icon.png`,
  email: "angliaeducate@gmail.com",
  description:
    "Live online Biology, Chemistry and Physics tutoring for KS3, GCSE, IGCSE and A Level students.",
  areaServed: "GB",
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // `viewport-fit=cover` lets the page extend under a phone's notch and home
      // indicator, so `env(safe-area-inset-*)` resolves and the shell can pad
      // for them (see `styles.css` — MOBILE).
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Anglia Educate — Online Science Tutoring for KS3, GCSE & A Level" },
      {
        name: "description",
        content:
          "Live online Biology, Chemistry and Physics tutoring for KS3, GCSE, IGCSE and A Level. AQA, Edexcel, OCR and Cambridge. Weekly quizzes, marked tasks and grade tracking.",
      },
      { property: "og:site_name", content: "Anglia Educate" },
      {
        property: "og:title",
        content: "Anglia Educate — Online Science Tutoring for KS3, GCSE & A Level",
      },
      {
        property: "og:description",
        content:
          "Live lessons with Dr Nadia and Ali. Curriculum-aligned to AQA, Edexcel, OCR and Cambridge. Grade predictor, weekly MCQs, and interactive tasks.",
      },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "en_GB" },
      // Link previews (WhatsApp, iMessage, Facebook) need an absolute URL.
      { property: "og:image", content: `${SITE_URL}/videos/how-it-works.jpg` },
      { property: "og:image:width", content: "1920" },
      { property: "og:image:height", content: "1080" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Anglia Educate" },
      {
        name: "twitter:description",
        content: "Live KS3, GCSE & A Level science tutoring with Dr Nadia and Ali.",
      },
      { name: "twitter:image", content: `${SITE_URL}/videos/how-it-works.jpg` },
    ],
    links: [
      // The SVG is the icon and the PNG its fallback, the pairing Safari shows
      // reliably; /favicon.ico stays in `public/` for anything that asks for it
      // directly. Bump `?v=` when the icon changes, or browsers that stored the
      // old one (or none) keep showing it.
      { rel: "alternate icon", type: "image/png", href: "/favicon.png?v=2" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg?v=2" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=2" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Plus+Jakarta+Sans:ital,wght@0,300..800;1,300..800&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
    // Tells Google what the business is, for richer search results.
    scripts: [{ type: "application/ld+json", children: JSON.stringify(ORGANIZATION_LD) }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return createElement(
    "html",
    { lang: "en" },
    createElement("head", null, createElement(HeadContent)),
    createElement("body", null, children, createElement(Scripts)),
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  // Booted on a server-rendered page: there is no loading screen still waiting
  // to hydrate, so guards on later navigations needn't wait for one. On a deep
  // link to a client-only route that signal belongs to `RoutePending` instead.
  useEffect(() => {
    if (!router.state.matches.some((match) => match.ssr === false)) markHydrated();
  }, [router]);

  // Back, by any button, lands on the card that was clicked to leave.
  useEffect(() => installReturnSpots(router), [router]);

  useEffect(() => {
    const onAuthChange = createAuthChangeHandler({ router, queryClient });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) =>
      onAuthChange(event, session?.user.id ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      {/* A fixed layer misses the body's notch padding, so the toasts keep
          sonner's own 24px or clear the notch, whichever is further in. */}
      <Toaster
        richColors
        position="top-right"
        offset={{
          top: "max(24px, env(safe-area-inset-top))",
          right: "max(24px, env(safe-area-inset-right))",
        }}
      />
      <Analytics />
    </QueryClientProvider>
  );
}
