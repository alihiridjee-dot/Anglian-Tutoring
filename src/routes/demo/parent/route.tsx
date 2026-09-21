import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RoutePending } from "@/components/RouteFallbacks";

/**
 * Layout for the parent showcase pages.
 *
 * Showcase mode is read off `window.location` (see `isDemoMode`), which the
 * server doesn't have. Rendered there, every page under here came out as a
 * *live* page — "Welcome back, there", "you're not enrolled", the signed-in
 * sidebar — which React then threw away with a hydration error and drew again
 * as the demo. On the one set of pages a prospective family sees first. Skipping
 * the server render, as the signed-in routes already do, means the first thing
 * drawn is the right thing.
 */
export const Route = createFileRoute("/demo/parent")({
  ssr: false,
  pendingComponent: RoutePending,
  component: Outlet,
});
