import { createFileRoute, Navigate } from "@tanstack/react-router";

// Preserve old onboarding links without collecting retired confidence ratings.
export const Route = createFileRoute("/onboarding/confidence")({
  component: () => <Navigate to="/onboarding/school" replace />,
});
