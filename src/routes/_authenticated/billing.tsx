import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { ErrorNote, SectionHeading, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useParentLinks } from "@/hooks/data/useParentLinks";
import { useViewer } from "@/hooks/useViewer";
import { PaymentPending } from "@/components/billing/PaymentPending";
import {
  parseCheckoutStatus,
  useCheckoutReturn,
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
} from "@/lib/billing/billing";
import { CadenceSwitcher } from "@/components/billing/CadenceSwitcher";
import { SubscriptionPanel } from "@/components/billing/SubscriptionPanel";
import { PlanLifecycleActions } from "@/components/billing/PlanLifecycleActions";
import { InvoiceHistoryCard } from "@/components/billing/InvoiceHistory";
import { AddSubjectTiles } from "@/components/billing/AddSubjectCard";
import { EnrolledSubjectsCard } from "@/components/billing/EnrolledSubjectsCard";
import { ParentBillingSection } from "@/components/billing/ParentBillingSection";
import { resolveDisplayName } from "@/lib/profile/displayName";
import { subjectLabel, summariseCourse } from "@/lib/curriculum/courseSummary";

export const Route = createFileRoute("/_authenticated/billing")({
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
    <div className="mt-8 pop-card pop-card-flat p-4 sm:p-5 text-sm">
      <p>
        Payments are handled by Stripe. Your card details go straight to them and are never seen or
        stored by Anglia Educate.
      </p>
      <Link
        to="/dashboard"
        className="text-primary mt-3 inline-flex min-h-11 items-center text-sm font-semibold hover:underline sm:pointer-fine:min-h-0"
      >
        ← Back to dashboard
      </Link>
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
 * The student view answers three questions in order, because that is the order
 * people actually ask them: what am I on and *who is paying for it*, what does
 * it cover (and how do I drop one subject), and how do I stop. The last of those
 * is PlanLifecycleActions, at the very bottom of the page, behind a four-step gate.
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

  return (
    <AppLayout title="Billing">
      <div className="max-w-4xl">
        {/* The page is a stack of tile sections: subjects, the plan (folded
            away), payment history (folded away), and — last — pause or
            cancel. */}
        {/* What the plan covers, where a single subject comes off it and where
            one is added — one grid. First on the page, above the plan, because
            it is what a family comes here to change; "cancel Chemistry" is a
            far commoner intent than "cancel everything", and the cancel dialog
            links here. Any student can add a subject to their
            own live plan, even when a parent holds the pause/cancel controls:
            adding is additive growth, so it isn't gated like they are. */}
        {userId && hasUsablePlan && sub?.plan && (
          <div className="mb-8">
            <EnrolledSubjectsCard
              studentId={userId}
              currentTier={sub.plan}
              enrolments={enrolments}
              level={level}
              canManage={canManage && changeable}
              canChangeBoard
              extraTiles={
                changeable && (
                  <AddSubjectTiles
                    studentId={userId}
                    currentTier={sub.plan}
                    enrolledSubjects={enrolledCourses}
                    defaultBoard={enrolments[0]?.board}
                    level={level}
                  />
                )
              }
            />
          </div>
        )}

        {(hasUsablePlan || paymentOverdue) && sub && !loading && !subsQuery.error ? (
          <div className="mb-8">
            <SubscriptionPanel
              sub={sub}
              canManage={canManage}
              isPayer={isPayer}
              returnTo="billing"
              payerLabel={payerLabel}
              priceLabel={priceLabel}
              course={course}
              // An overdue plan has no Subjects block above to name them.
              showSubjects={paymentOverdue}
              // How often they pay, opened from the plan's Switch payment tile.
              // Only on a live plan that isn't ending, for whoever manages it.
              cadenceSwitcher={
                userId &&
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
              <div className="pop-card pop-card-flat mt-3 flex gap-2.5 p-4 text-sm">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  This plan is paid for by <strong>{payerLabel}</strong>, so pausing, changing and
                  cancelling it happen from their account. Ask them to open their own Billing tab —
                  you'll see any change here straight away.
                </span>
              </div>
            )}
          </div>
        ) : (
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
                    You don't have an active plan yet. Pick one below to unlock lessons, quizzes,
                    and task marking.
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
        )}

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

        {/* Pause and cancel come last, under everything a family might want
            to do first. */}
        {(hasUsablePlan || paymentOverdue) && sub && (
          <div className="mb-8">
            <PlanLifecycleActions
              sub={sub}
              planName={planName}
              canManage={canManage}
              course={course}
            />
          </div>
        )}

        <StripeFooter />
      </div>
    </AppLayout>
  );
}
