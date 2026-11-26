import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { guardNotStaff } from "@/lib/auth/routeGuards";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useParentLinks } from "@/hooks/data/useParentLinks";
import { useViewer } from "@/hooks/useViewer";
import { PaymentPending } from "@/components/billing/PaymentPending";
import {
  parseCheckoutStatus,
  useCheckoutReturn,
  useInvoices,
  usePackages,
  useSubscriptions,
  type CheckoutStatus,
} from "@/hooks/data/useBilling";
import {
  isSubscriptionLive,
  isPaymentOverdue,
  isPlanChangeable,
  planLabel,
  formatPence,
  billingIntervalLabel,
  PLAN_STATUS_LABELS,
  planStatusTint,
} from "@/lib/billing/billing";
import { CadenceSwitcher } from "@/components/billing/CadenceSwitcher";
import { SubscriptionPanel } from "@/components/billing/SubscriptionPanel";
import { PlanLifecycleActions } from "@/components/billing/PlanLifecycleActions";
import { InvoiceHistory, InvoiceHistoryCard } from "@/components/billing/InvoiceHistory";
import { AddSubjectRows } from "@/components/billing/AddSubjectCard";
import { BillingTrail, type BillingStop } from "@/components/billing/BillingTrail";
import { breakCardQuery } from "@/lib/planner/breakQueries";
import { currentWeekKey } from "@/lib/planner/week";
import { EnrolledSubjectsCard } from "@/components/billing/EnrolledSubjectsCard";
import { ParentBillingSection } from "@/components/billing/ParentBillingSection";
import { TakeABreakCard } from "@/components/billing/TakeABreakCard";
import { resolveDisplayName } from "@/lib/profile/displayName";
import { subjectLabel, summariseCourse } from "@/lib/curriculum/courseSummary";

export const Route = createFileRoute("/_authenticated/billing")({
  beforeLoad: guardNotStaff,
  // Stripe Checkout returns here with ?checkout=success|cancelled.
  validateSearch: (search: Record<string, unknown>): { checkout?: CheckoutStatus } => ({
    checkout: parseCheckoutStatus(search.checkout),
  }),
  head: () => ({ meta: [{ title: "Billing | Anglia Educate" }] }),
  component: BillingPage,
});

/** The Stripe reassurance + back-link, shared by both persona views. */
function StripeFooter() {
  return (
    <div className="mt-8 flex items-start gap-3 px-1">
      <span className="icon-tile tint-emerald size-9 shrink-0">
        <ShieldCheck className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p>
          <strong>Secure payments by Stripe.</strong> Your card details go straight to Stripe and
          are never seen or stored by Anglia Educate.
        </p>
        <Link
          to="/dashboard"
          className="text-primary mt-1 inline-flex min-h-11 items-center font-bold hover:underline sm:pointer-fine:min-h-0"
        >
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}

/**
 * Billing — a full tab, one home for everything money-shaped.
 *
 * Everything here is a redirect to Stripe (checkout, portal) or a call into the
 * stripe-checkout edge function (pause/cancel/resume, add/remove subjects,
 * invoices). Card details are never entered into this app.
 *
 * Two personas share the route:
 *   • Parent — manages and pays for each linked child's plan, with payment
 *     history.
 *   • Student — their own plan.
 *
 * The student view with a plan is a trail (BillingTrail): Subjects → Plan →
 * Payments → Break as round stops, the picked one open in one card underneath.
 * Dropping a subject, pausing and cancelling are PlanLifecycleActions, under
 * the trail at the very bottom of the page, behind a four-step gate.
 */
function BillingPage() {
  const { enrolledCourses, enrolments, role: profileRole, level } = useEnrolments();
  // Who is looking, from the guard — known on first render. This used to be a
  // `getUser()` round trip from an effect, and `loading` waited on it: one
  // failed request and "Current plan" spun for ever, on the page a student
  // opens precisely when something is already wrong.
  const viewer = useViewer();
  const userId = viewer?.userId ?? null;
  const role = profileRole ?? (viewer?.appRole === "parent" ? "parent" : null);
  const { checkout } = Route.useSearch();
  const navigate = useNavigate();

  const { data: packages = [], isLoading: packagesLoading } = usePackages(level);
  const subsQuery = useSubscriptions(userId ? [userId] : []);
  const { data: subs = [], isLoading: subsLoading } = subsQuery;
  // A student's linked parents (empty for the parent view) — used to name the
  // payer and to decide whether the student manages their own plan.
  const { data: linkedParents = [], isLoading: parentsLoading } = useParentLinks(role !== "parent");
  // Read here too (shared cache) so the trail can leave out a Payments stop
  // with nothing behind it, and name a break that stands.
  const invoicesQuery = useInvoices(role !== "parent");
  const breaksQuery = useQuery({
    ...breakCardQuery(userId ?? ""),
    enabled: !!userId && role !== "parent",
  });
  const sub = subs[0] ?? null;
  const loading = packagesLoading || subsLoading;
  const hasUsablePlan = !!sub && (isSubscriptionLive(sub.status) || sub.status === "paused");
  // A failed payment still has a plan to show — with the card-update button —
  // but nothing to change on it and nothing to buy on top of it.
  const paymentOverdue = !!sub && isPaymentOverdue(sub.status);
  // Subjects and cadence change only on a live plan that isn't cancelling. A
  // paused or ending one is refused by the server ("Resume the plan before…"),
  // so it is shown, but not offered changes.
  const changeable = isPlanChangeable(sub);

  const payment = useCheckoutReturn({
    status: checkout,
    // A parent's purchase is for one of several children, so "is it here yet"
    // can't be answered from this page — their cards simply refresh.
    confirmed: role === "parent" ? null : hasUsablePlan,
    onDone: () => void navigate({ to: "/billing", search: {}, replace: true }),
  });
  // Paid but not yet visible. Nothing may offer Checkout while this is true.
  const awaitingPayment = payment.confirming || payment.delayed;

  // ---- Parent: manage each linked child's plan + payment history. ----
  if (role === "parent") {
    return (
      <AppLayout title="Billing">
        <div className="max-w-4xl">
          {userId ? (
            <ParentBillingSection parentId={userId} awaitingPayment={awaitingPayment} />
          ) : (
            <Spinner label="Loading" className="py-8" />
          )}
          <StripeFooter />
        </div>
      </AppLayout>
    );
  }

  // ---- Student: their own plan. ----
  const activeTier = hasUsablePlan ? sub.plan : null;
  const isPayer = !!sub && !!userId && sub.user_id === userId;

  // Who controls the plan, mirroring assertCanManage() on the server: the payer
  // always — nobody is charged with no way to stop — or a student with no linked
  // parent. Only a student on someone else's card is read-only. Wait for the
  // links query so controls don't flicker in and then vanish.
  const linksSettled = !parentsLoading;
  const canManage = linksSettled && (isPayer || linkedParents.length === 0);

  // Name the payer rather than leaving it to be inferred. A linked parent who
  // holds the subscription is named; a payer we can't resolve is described
  // honestly instead of being guessed at.
  const payingParent = sub ? linkedParents.find((p) => p.parent_id === sub.user_id) : undefined;
  const payerLabel = !sub
    ? undefined
    : isPayer
      ? "you"
      : payingParent
        ? resolveDisplayName(payingParent.display_name, payingParent.email)
        : "someone else in your household";

  const planName = planLabel(sub?.plan, packages);
  const activePkg = packages.find((p) => p.tier === sub?.plan);
  const priceLabel = activePkg
    ? `${formatPence(activePkg.price_pence)} ${billingIntervalLabel(activePkg.billing_interval)}`.trim()
    : undefined;
  const subjectLabels = enrolments.map((e) => subjectLabel(e.subject));
  // Level + board — what the plan actually teaches. Mixed boards are named
  // per subject just below, in EnrolledSubjectsCard.
  const course = summariseCourse(level, enrolments);

  // ---- With a plan (or one whose payment failed): the trail. ----
  if ((hasUsablePlan || paymentOverdue) && sub && !loading && !subsQuery.error && userId) {
    const thisWeek = currentWeekKey();
    const standing = (breaksQuery.data ?? []).filter((b) => b.endsOn >= thisWeek);
    const breakWord = !standing.length
      ? "Up to a month"
      : standing[0].startsOn <= thisWeek
        ? "You're away"
        : "Booked";
    const subjectCountWord =
      ["None", "One", "Two", "Three"][enrolments.length] ?? String(enrolments.length);
    // Drawn once there is something behind it (or a failed read to say so),
    // so the trail doesn't lose a stop as the payments arrive.
    const showPayments =
      invoicesQuery.isError || (invoicesQuery.isSuccess && invoicesQuery.data.length > 0);

    const stops: BillingStop[] = [];
    // What the plan covers, where a board is switched and a subject added.
    // Any student can add a subject to their own live plan, even when a
    // parent holds the pause/cancel controls: adding is growth, not gated
    // like they are.
    if (sub.plan && enrolments.length > 0)
      stops.push({
        key: "subjects",
        emoji: "📚",
        name: "Subjects",
        word: `${subjectCountWord} on your plan`,
        tint: "tint-primary",
        body: (
          <EnrolledSubjectsCard
            bare
            studentId={userId}
            enrolments={enrolments}
            level={level}
            canChangeBoard
            extraRows={
              changeable &&
              sub.plan && (
                <AddSubjectRows
                  studentId={userId}
                  currentTier={sub.plan}
                  enrolledSubjects={enrolledCourses}
                  defaultBoard={enrolments[0]?.board}
                  level={level}
                />
              )
            }
          />
        ),
      });
    stops.push({
      key: "plan",
      emoji: "💳",
      name: "Plan",
      word: sub.cancel_at_period_end ? "Ending" : (PLAN_STATUS_LABELS[sub.status] ?? sub.status),
      tint: planStatusTint(sub.status),
      body: (
        <>
          <SubscriptionPanel
            bare
            sub={sub}
            canManage={canManage}
            isPayer={isPayer}
            returnTo="billing"
            payerLabel={payerLabel}
            priceLabel={priceLabel}
            course={course}
            // How often they pay, opened from the plan's own button. Only on a
            // live plan that isn't ending, for whoever manages it.
            cadenceSwitcher={
              changeable &&
              canManage && (
                <CadenceSwitcher
                  studentId={userId}
                  currentTier={activeTier}
                  subjectCount={enrolments.length}
                  level={level}
                  canManage
                  hadPlan
                  hideHeading
                />
              )
            }
          />
          {!canManage && linksSettled && (
            <p className="mt-4 px-2 pb-2 sm:px-3">
              This plan is paid for by <strong>{payerLabel}</strong>, so pausing, changing and
              cancelling it happen from their account. Ask them to open their own Billing tab —
              you&apos;ll see any change here straight away.
            </p>
          )}
        </>
      ),
    });
    // Shared household history: a student sees payments on their plan even
    // when a linked parent's card was charged. No payments, no stop.
    if (showPayments)
      stops.push({
        key: "payments",
        emoji: "🧾",
        name: "Payments",
        word: "Receipts",
        tint: "tint-amber",
        body: <InvoiceHistory />,
      });
    // A break from the work, not the plan: the plan and its payments carry on.
    if (isSubscriptionLive(sub.status))
      stops.push({
        key: "break",
        emoji: "🌴",
        name: "Break",
        word: breakWord,
        tint: "tint-accent",
        body: <TakeABreakCard bare studentId={userId} />,
      });

    return (
      <AppLayout title="Billing">
        <div className="max-w-4xl">
          <div className="mb-8">
            {/* A paused plan (Resume) or a failed payment (the card fix) opens
                on its Plan stop. */}
            <BillingTrail
              stops={stops}
              initial={sub.status === "paused" || paymentOverdue ? "plan" : undefined}
            />
          </div>

          {/* Drop a subject, pause and cancel come last, under everything a
              family might want to do first. */}
          <div className="mb-8">
            <PlanLifecycleActions
              sub={sub}
              planName={planName}
              canManage={canManage}
              course={course}
              level={level}
            />
          </div>

          <StripeFooter />
        </div>
      </AppLayout>
    );
  }

  // ---- No plan yet (or still loading, or couldn't read it). ----
  return (
    <AppLayout title="Billing">
      <div className="max-w-4xl">
        <section className="mb-8">
          <SectionHeading title="Your plan" />
          <div className="mt-3">
            {loading ? (
              <Spinner label="Loading" className="py-8" />
            ) : subsQuery.error ? (
              // "Couldn't read your plan" is not "you have no plan". Falling
              // through to the branch below told a paying student to pick a
              // plan, with the shop open underneath.
              <ErrorNote error={subsQuery.error} onRetry={() => void subsQuery.refetch()} />
            ) : awaitingPayment ? (
              <PaymentPending delayed={payment.delayed} onRetry={payment.retry} />
            ) : (
              <div className="pop-card p-4 sm:p-5">
                <p>
                  You don't have an active plan yet. Pick one below to unlock lessons, quizzes, and
                  task marking.
                </p>
                {/* Still say what they'd be buying — the course is set at
                    signup and is the thing worth checking before paying. */}
                {course.headline && (
                  <p className="mt-2 text-sm">
                    Set up for <strong>{course.headline}</strong>
                    {subjectLabels.length > 0 && ` — ${subjectLabels.join(", ")}`}.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* The shop, for a student with no plan: how often to pay, which is
            all there is to pick — coverage is the subjects they enrolled in.
            Not shown until the plan and parent links have loaded: until then
            there is no plan to see, and the shop would open under a paying
            student's "Loading" spinner. */}
        {userId &&
          !loading &&
          linksSettled &&
          !subsQuery.error &&
          !awaitingPayment &&
          !paymentOverdue &&
          !hasUsablePlan && (
            <div className="mb-8">
              <CadenceSwitcher
                studentId={userId}
                currentTier={null}
                subjectCount={enrolments.length}
                level={level}
                canManage
                hadPlan={!!sub}
              />
            </div>
          )}

        {/* Shared household history: a student sees payments on their plan even
            when a linked parent's card was charged. Empty ("No payments yet")
            for a student with no plan and no linked payer. */}
        <div className="mb-8">
          <InvoiceHistoryCard />
        </div>

        <StripeFooter />
      </div>
    </AppLayout>
  );
}
