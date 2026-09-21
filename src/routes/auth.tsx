import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AuthShell, BrandPanel } from "@/components/auth/AuthShell";
import { useAuthFlow, type SearchParams } from "@/components/auth/useAuthFlow";
import { CredentialsForm, VerifyCodeScreen } from "@/components/auth/AuthForms";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in | Anglia Educate" },
      { name: "description", content: "Log in or create your Anglia Educate account." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    mode: search.mode === "signup" ? "signup" : "signin",
    tier: typeof search.tier === "string" ? search.tier : undefined,
    level: typeof search.level === "string" ? search.level : undefined,
    subjects: typeof search.subjects === "string" ? search.subjects : undefined,
    board: typeof search.board === "string" ? search.board : undefined,
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const flow = useAuthFlow(navigate, search);

  return (
    <AuthShell>
      <div className="grid lg:grid-cols-[1.05fr_1fr] gap-8 items-stretch">
        <BrandPanel />
        <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in [--rise-delay:80ms] self-center w-full">
          {flow.emailSentTo ? (
            <VerifyCodeScreen flow={flow} />
          ) : (
            <CredentialsForm flow={flow} tier={search.tier} />
          )}
        </div>
      </div>
    </AuthShell>
  );
}
