import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePackages, useChangeCadence } from "@/hooks/data/useBilling";
import { formatPence, billingIntervalLabel, startCheckout } from "@/lib/billing";
import { planCadence, tierFor, CADENCES, type Cadence } from "@/lib/entitlements";
import { CadenceChangeDialog } from "@/components/billing/CadenceChangeDialog";

interface CadenceSwitcherProps {
  /** subscriptions.student_id whose billing rhythm this is. */
  studentId: string;
  /**
   * Their current tier, or null when they have no plan yet — in which case the
   * rows become a buy action (Checkout) rather than a switch.
   */
  currentTier: string | null;
  /** How many subjects they're enrolled in; prices every row at that count. */
  subjectCount: number;
  /** Exam level, so prices come off the right ladder. */
  level?: string | null;
  /** Whether the viewer may change billing terms. Read-only display if not. */
  canManage: boolean;
  /** Whose plan it is ("Alex"), for the parent view. Omit for own plan. */
  ownerLabel?: string;
}

/**
 * How often the family pays — and nothing else.
 *
 * This replaces a nine-card grid (three cadences × three subject counts) that
 * conflated two unrelated decisions. Coverage is owned by EnrolledSubjectsCard
 * and AddSubjectCard, which ask which subjects and enrol properly; all that's
 * left here is the rhythm, so it collapses to three rows priced at whatever the
 * student actually studies.
 *
 * Collapsing it also removes a whole class of bug: the old grid let someone
 * click `monthly_3` while enrolled in two subjects, buying coverage they never
 * received. A row here cannot change the subject count, so it cannot do that.
 *
 * Switching an existing plan edits the live Stripe subscription (prorated).
 * Only a family with no plan at all goes through Checkout.
 */
export function CadenceSwitcher({
  studentId,
  currentTier,
  subjectCount,
  level,
  canManage,
  ownerLabel,
}: CadenceSwitcherProps) {
  const { data: packages = [] } = usePackages(level);
  const change = useChangeCadence();
  const [pending, setPending] = useState<Cadence | null>(null);
  const [buying, setBuying] = useState<Cadence | null>(null);

  const current = planCadence(currentTier);
  const count = Math.max(subjectCount, 1);
  const pkgFor = (c: Cadence) => packages.find((p) => p.tier === tierFor(c, count));

  // Everything is quoted per week so three different billing rhythms can be
  // compared at a glance — the entire reason someone opens this control.
  const perWeek = (c: Cadence) => {
    const pence = pkgFor(c)?.price_pence;
    if (pence == null) return null;
    return c === "weekly" ? pence : c === "monthly" ? pence / 4.345 : pence / 13;
  };
  const weeklyBaseline = perWeek("weekly");

  const buy = async (c: Cadence) => {
    setBuying(c);
    try {
      await startCheckout({ tier: tierFor(c, count), studentId, returnTo: "billing" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open checkout — try again.");
      setBuying(null);
    }
  };

  const confirm = (c: Cadence) => {
    change.mutate(
      { studentId, cadence: c },
      {
        onSuccess: (res) => {
          setPending(null);
          toast.success(`Now on ${res.plan_name}.`, {
            description:
              res.amount_due_now != null
                ? `${formatPence(res.amount_due_now, res.currency)} charged today, prorated.`
                : "Stripe has prorated the change.",
          });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="rounded-2xl premium-card p-6">
      <h3 className="font-display text-lg font-semibold">
        {currentTier ? "How often you pay" : "Choose how often you pay"}
      </h3>
      <p className="text-sm text-muted-foreground mt-0.5">
        Same {count === 1 ? "subject" : `${count} subjects`}, same tutoring — pay less by committing
        for longer. {currentTier && "Switching is prorated, never a fresh charge."}
      </p>

      <div className="mt-4 space-y-2">
        {CADENCES.map((c) => {
          const pkg = pkgFor(c.key);
          if (!pkg) return null;
          const isCurrent = current === c.key && !!currentTier;
          const each = perWeek(c.key);
          const saving =
            weeklyBaseline && each && c.key !== "weekly"
              ? Math.round((1 - each / weeklyBaseline) * 100)
              : 0;

          return (
            <div
              key={c.key}
              className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition ${
                isCurrent ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{c.label}</span>
                  {isCurrent && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground uppercase tracking-wider font-bold">
                      Current
                    </span>
                  )}
                  {saving > 0 && !isCurrent && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider font-bold">
                      Save {saving}%
                    </span>
                  )}
                </div>
                <div className="font-display text-xl font-bold mt-0.5">
                  {formatPence(pkg.price_pence)}
                  <span className="text-xs font-medium text-muted-foreground">
                    {" "}
                    {billingIntervalLabel(pkg.billing_interval)}
                  </span>
                </div>
                {each != null && c.key !== "weekly" && (
                  <div className="text-[11px] text-muted-foreground">
                    ≈ {formatPence(Math.round(each))} a week
                  </div>
                )}
              </div>

              {isCurrent ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary shrink-0">
                  <Check className="w-4 h-4" /> Active
                </span>
              ) : canManage ? (
                <button
                  onClick={() => (currentTier ? setPending(c.key) : buy(c.key))}
                  disabled={buying !== null || change.isPending}
                  className="h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 shrink-0 inline-flex items-center gap-1.5"
                >
                  {buying === c.key && <Loader2 className="w-4 h-4 animate-spin" />}
                  {currentTier ? "Switch" : "Choose"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {pending && (
        <CadenceChangeDialog
          studentId={studentId}
          cadence={pending}
          cadenceLabel={CADENCES.find((c) => c.key === pending)?.label ?? pending}
          subjectCount={count}
          ownerLabel={ownerLabel}
          pending={change.isPending}
          onConfirm={() => confirm(pending)}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
