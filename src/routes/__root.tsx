import { Toaster } from "sonner";
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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
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

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Anglia Educate — GCSE & KS3 Science Tutoring" },
      {
        name: "description",
        content:
          "Expert-led online Biology, Chemistry and Physics tutoring for KS3 and GCSE. Live lessons, weekly quizzes, homework marking and grade tracking.",
      },
      { property: "og:title", content: "Anglia Educate — GCSE & KS3 Science Tutoring" },
      {
        property: "og:description",
        content:
          "Live lessons with Dr Nadia and Ali. Curriculum-aligned to Edexcel, AQA, and OCR. Grade predictor, weekly MCQs, and interactive homework.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Anglia Educate" },
      {
        name: "twitter:description",
        content: "Live GCSE & KS3 science tutoring with Dr Nadia and Ali.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Plus+Jakarta+Sans:ital,wght@0,300..800;1,300..800&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
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

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
