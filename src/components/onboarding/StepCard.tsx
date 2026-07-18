import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

/**
 * The frame every setup step shares: title, body, and a footer whose back /
 * skip / continue buttons are the only way through the flow.
 */
export function StepCard({
  title,
  subtitle,
  children,
  onBack,
  onSkip,
  onContinue,
  continueLabel = "Continue",
  continueDisabled,
  saving,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onSkip?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  saving?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 shadow-lg">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-1">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground mb-6">{subtitle}</p>}

      <div className="space-y-4">{children}</div>

      <div className="mt-8 flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
        <div className="flex-1" />
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="h-11 px-4 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Skip for now
          </button>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={continueDisabled || saving}
          className="inline-flex items-center gap-1.5 h-11 px-6 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 text-sm shadow-sm"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              {continueLabel} <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/** A large, obviously-clickable choice tile. */
export function ChoiceTile({
  selected,
  onClick,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-4 transition ${
        selected
          ? "border-primary bg-primary/10 ring-2 ring-primary/30"
          : "border-border bg-muted/40 hover:border-primary/50"
      }`}
    >
      <div className="font-semibold text-sm">{title}</div>
      {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
    </button>
  );
}
