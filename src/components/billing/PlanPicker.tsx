import { Check, Loader2 } from "lucide-react";
import { billingIntervalLabel, formatPence, type PackageRow } from "@/lib/billing";

interface PlanPickerProps {
  packages: PackageRow[];
  /** Tier currently live for the student being shopped for, if any. */
  activeTier: string | null;
  /** Tier whose checkout redirect is in flight, if any. */
  busyTier: string | null;
  onChoose: (tier: string) => void;
}

/**
 * The plan grid, shared by the student billing page and the parent dashboard.
 * Pure display — who is paying and for whom is the caller's business.
 */
export function PlanPicker({ packages, activeTier, busyTier, onChoose }: PlanPickerProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {packages.map((p) => {
        const isCurrent = activeTier === p.tier;
        return (
          <div
            key={p.id}
            className={`rounded-2xl p-6 border flex flex-col ${
              isCurrent ? "border-accent bg-accent/5" : "border-border bg-card"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-display font-semibold text-lg">{p.name}</h4>
              {isCurrent && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-accent text-accent-foreground uppercase tracking-widest font-bold">
                  Current
                </span>
              )}
            </div>
            {p.description && (
              <p className="text-sm text-muted-foreground flex-1">{p.description}</p>
            )}
            <p className="mt-3 font-display text-3xl font-bold">
              {formatPence(p.price_pence)}
              <span className="text-sm text-muted-foreground font-normal">
                {" "}
                {billingIntervalLabel(p.billing_interval)}
              </span>
            </p>
            <button
              disabled={isCurrent || busyTier !== null}
              onClick={() => onChoose(p.tier)}
              className="mt-5 w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-40 inline-flex items-center justify-center gap-2"
            >
              {busyTier === p.tier ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Opening…
                </>
              ) : isCurrent ? (
                <>
                  <Check className="w-4 h-4" /> Active
                </>
              ) : activeTier ? (
                "Switch to this"
              ) : (
                "Choose plan"
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
