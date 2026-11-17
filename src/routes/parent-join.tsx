import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, Loader2, Lock, LogOut } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/AuthShell";
import { CredentialsForm, VerifyCodeScreen } from "@/components/auth/AuthForms";
import { useAuthFlow } from "@/components/auth/useAuthFlow";
import { EmptyState, ErrorNote, Spinner } from "@/components/Shared";
import { RoutePending } from "@/components/RouteFallbacks";
import { CadencePicker, PlanSummary, PlanTotal } from "@/components/onboarding/PlanStepParts";
import { CADENCES } from "@/components/onboarding/usePlanStep";
import { usePackages } from "@/hooks/data/useBilling";
import { usePageRestore } from "@/hooks/usePageRestore";
import { supabase } from "@/integrations/supabase/client";
import { getAuthSession } from "@/lib/auth/session";
import { whenHydrated } from "@/lib/auth/hydration";
import { invalidateGuardState, loadGuardState } from "@/lib/auth/guardState";
import { startCheckout } from "@/lib/billing/billing";
import type { Cadence } from "@/lib/billing/entitlements";
import type { Enrolment } from "@/lib/profile/enrolment";
import {
  PARENT_JOIN_PATH,
  forgetParentJoin,
  peekParentJoinLink,
  readParentJoin,
  redeemParentJoinLink,
  rememberParentJoin,
  type ParentJoinPlan,
} from "@/lib/billing/parentJoin";
import { UserRole } from "@/types/user";

/**
 * A parent's "My parent is paying" link, opened on their own phone.
 *
 * The child pressed "My parent is paying" on their plan page and showed a QR
 * code. Here the parent sees the child's plan, makes a parent account (or logs
 * in), is linked to the child by the link itself, and goes to Stripe. The
 * child's screen is waiting and opens the moment the payment lands.
 *
 * Outside /_authenticated on purpose: the parent arrives signed out. The rules
 * are the database's (`peek_parent_join_link`, `redeem_parent_join_link`): one
 * parent, once, within 24 hours.
 */
export const Route = createFileRoute("/parent-join")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pay for your child's plan | Anglia Educate" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { t?: string } => ({
    t: typeof search.t === "string" ? search.t : undefined,
  }),
  beforeLoad: async ({ context }) => {
    await whenHydrated();
    const session = await getAuthSession();
    if (!session.user) return { joiner: null };
    const viewer = await loadGuardState(context.queryClient, session.user.id);
    return { joiner: { userId: session.user.id, role: viewer.appRole } };
  },
  pendingComponent: RoutePending,
  component: ParentJoinPage,
});

function ParentJoinPage() {
  const { t } = Route.useSearch();
  const { joiner } = Route.useRouteContext();
  const navigate = useNavigate();

  // The token from the link, kept in this browser for the sign-up's round
  // trips (the email code, Google), and taken out of the address bar.
  const [token] = useState(() => t ?? readParentJoin());
  useEffect(() => {
    if (!t) return;
    rememberParentJoin(t);
    void navigate({ to: PARENT_JOIN_PATH, search: {}, replace: true });
  }, [t, navigate]);

  const peek = useQuery({
    queryKey: ["parent-join", "peek", token, joiner?.userId ?? null],
    queryFn: () => peekParentJoinLink(token!),
    enabled: !!token,
    retry: 1,
  });
  const dead = peek.data && peek.data.status !== "ok" ? peek.data.status : null;
  useEffect(() => {
    if (dead) forgetParentJoin();
  }, [dead]);

  let body: React.ReactNode;
  if (!token) body = <DeadLink reason="not_found" signedIn={!!joiner} />;
  else if (peek.isPending) body = <Spinner className="py-16" />;
  else if (peek.error) body = <ErrorNote error={peek.error} onRetry={() => void peek.refetch()} />;
  else if (peek.data.status !== "ok")
    body = <DeadLink reason={peek.data.status} signedIn={!!joiner} />;
  else if (!joiner) body = <SignUpStep plan={peek.data} />;
  else if (joiner.role === UserRole.PARENT) body = <PayStep token={token} />;
  else body = <NotAParent role={joiner.role} />;

  return <AuthShell>{body}</AuthShell>;
}

/** Signed out: the child's plan beside the parent sign-up form. */
function SignUpStep({ plan }: { plan: ParentJoinPlan }) {
  const navigate = useNavigate();
  const flow = useAuthFlow(
    navigate,
    { mode: "signup", redirect: PARENT_JOIN_PATH },
    { parentJoin: true },
  );
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
      <div className="premium-card rise-in rounded-3xl p-6 sm:p-8">
        <h2 className="mb-4 text-2xl font-bold tracking-tight">{plan.student_name}&apos;s plan</h2>
        <PlanPrice plan={plan} cadence={plan.cadence} />
      </div>
      <div className="premium-card rise-in w-full rounded-3xl p-6 [--rise-delay:80ms] sm:p-8">
        {flow.emailSentTo ? (
          <VerifyCodeScreen flow={flow} />
        ) : (
          <CredentialsForm flow={flow} joining={plan.student_name} />
        )}
      </div>
    </div>
  );
}

/** The plan's subjects and its price at `cadence`, the onboarding page's parts. */
function PlanPrice({
  plan,
  cadence,
  setCadence,
}: {
  plan: ParentJoinPlan;
  cadence: Cadence;
  setCadence?: React.Dispatch<React.SetStateAction<Cadence>>;
}) {
  const { data: packages = [], isLoading, error, refetch } = usePackages(plan.level);
  // Priced on the subjects the child takes, clamped to the tiers we sell. The
  // server counts them again at Checkout, as it does for the child.
  const count = Math.min(Math.max(plan.subjects.length, 1), 3);
  const pkg = packages.find((p) => p.tier === `${cadence}_${count}`);
  const unit = CADENCES.find((c) => c.key === cadence)?.unit ?? "";
  return (
    <>
      <PlanSummary level={plan.level} enrolments={plan.subjects as Enrolment[]} />
      {setCadence && <CadencePicker cadence={cadence} setCadence={setCadence} />}
      {isLoading ? (
        <Spinner className="py-8" />
      ) : error ? (
        <div className="mt-6">
          <ErrorNote error={error} onRetry={() => void refetch()} />
        </div>
      ) : (
        <PlanTotal selectedPkg={pkg} selectedUnit={unit} />
      )}
    </>
  );
}

/** Signed in as a parent: linked to the child by the link, then Stripe. */
function PayStep({ token }: { token: string }) {
  const redeem = useMutation({ mutationFn: () => redeemParentJoinLink(token) });
  useEffect(() => {
    redeem.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const result = redeem.data;
  if (redeem.isPending || (!result && !redeem.error)) {
    return <Spinner label="Linking you to your child" className="py-16" />;
  }
  if (redeem.error) {
    return <ErrorNote error={redeem.error} onRetry={() => redeem.mutate()} />;
  }
  if (result!.status === "linked" || result!.status === "already_linked") {
    return <PayCard studentId={result!.student_id} plan={result!} />;
  }
  if (result!.status === "not_a_parent") return <NotAParent role={UserRole.STUDENT} />;
  return <DeadLink reason={result!.status} signedIn />;
}

function PayCard({ studentId, plan }: { studentId: string; plan: ParentJoinPlan }) {
  const [cadence, setCadence] = useState<Cadence>(plan.cadence);
  const [redirecting, setRedirecting] = useState(false);
  // Back from Stripe restores this page as it was left, spinner and all.
  usePageRestore(() => setRedirecting(false));
  const { data: packages = [] } = usePackages(plan.level);
  const count = Math.min(Math.max(plan.subjects.length, 1), 3);
  const pkg = packages.find((p) => p.tier === `${cadence}_${count}`);

  const pay = async () => {
    if (!pkg) return;
    setRedirecting(true);
    try {
      // Back from Stripe lands on Billing, where a parent's children and their
      // plans are. The child's own screen opens by itself.
      await startCheckout({ tier: pkg.tier, studentId, returnTo: "billing" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open checkout. Try again.");
      setRedirecting(false);
    }
  };

  return (
    <div className="premium-card rise-in mx-auto max-w-2xl rounded-3xl p-6 sm:p-8">
      <p className="tint-emerald flex items-center gap-2.5 text-[0.9375rem] font-bold">
        <span className="icon-tile icon-tile-solid size-7 shrink-0 rounded-full">
          <Check className="size-4" strokeWidth={3} aria-hidden />
        </span>
        You&apos;re linked to {plan.student_name}
      </p>
      <h1 className="mt-5 mb-4 text-2xl font-bold tracking-tight">
        {plan.student_name}&apos;s plan
      </h1>
      <PlanPrice plan={plan} cadence={cadence} setCadence={setCadence} />
      <button
        type="button"
        onClick={pay}
        disabled={!pkg || redirecting}
        className="btn-premium mt-7 inline-flex h-13 w-full items-center justify-center gap-2 rounded-2xl text-base"
      >
        {redirecting ? (
          <>
            <Loader2 className="size-5 animate-spin" /> Taking you to Stripe…
          </>
        ) : (
          <>
            <CreditCard className="size-5" /> Continue to payment
          </>
        )}
      </button>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-sm font-medium">
        <Lock className="size-4 text-[color:var(--tint)]" aria-hidden /> Card details go to Stripe,
        never to us
      </p>
    </div>
  );
}

const DEAD_LINK: Record<string, { title: string; body: string }> = {
  used: {
    title: "This link has already been used",
    body: "Each link works once. Ask your child to press “My parent is paying” again for a new one.",
  },
  expired: {
    title: "This link has run out",
    body: "Links work for 24 hours, and only the newest one works. Ask your child for a new one.",
  },
  not_found: {
    title: "We can't find this link",
    body: "Open the link your child sent you again, or ask them to press “My parent is paying” for a new one.",
  },
};

function DeadLink({ reason, signedIn }: { reason: string; signedIn: boolean }) {
  const copy = DEAD_LINK[reason] ?? DEAD_LINK.not_found;
  return (
    <div className="mx-auto max-w-xl">
      <EmptyState
        title={copy.title}
        body={copy.body}
        action={signedIn ? { to: "/dashboard", label: "Go to your dashboard" } : undefined}
      />
    </div>
  );
}

/**
 * Signed in, but not as a parent. A brand-new Google or Microsoft account is
 * made as a student, so it is offered the parent role first: the database
 * grants it only to an untouched account under 30 minutes old.
 */
function NotAParent({ role }: { role: UserRole }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const claim = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("claim_parent_role");
      if (error) throw new Error(error.message);
      return (data as { status?: string } | null)?.status;
    },
    onSuccess: (status) => {
      if (status !== "claimed" && status !== "already_parent") return;
      invalidateGuardState(queryClient);
      void router.invalidate();
    },
  });
  useEffect(() => {
    if (role === UserRole.STUDENT) claim.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Only this browser: the default ends the session everywhere, and this could
  // be the child's own account, still waiting on their plan page.
  const signOutHere = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut({ scope: "local" });
    void router.invalidate();
  };

  if (claim.isPending) return <Spinner className="py-16" />;
  const tutor = role === UserRole.TUTOR || role === UserRole.ADMIN;
  return (
    <div className="pop-card mx-auto flex max-w-xl flex-col items-center px-6 py-10 text-center">
      <h1 className="text-xl font-extrabold">
        {tutor ? "This is a tutor account" : "This is a student account"}
      </h1>
      <p className="mx-auto mt-2 max-w-md text-[0.9375rem] leading-relaxed">
        Paying for a child needs a parent account. Sign out here, then make one on this page.
      </p>
      <button
        type="button"
        onClick={signOutHere}
        className="btn-soft mt-6 inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm"
      >
        <LogOut className="size-4" aria-hidden /> Sign out
      </button>
    </div>
  );
}
