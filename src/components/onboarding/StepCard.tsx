import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";

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
    <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in">
      <h1 className="font-display text-2xl sm:text-[1.75rem] leading-tight font-bold tracking-tight mb-1.5">
        {title}
      </h1>
      {subtitle && <p className="text-sm text-muted-foreground mb-7 leading-relaxed">{subtitle}</p>}

      <div className="space-y-5">{children}</div>

      <div className="mt-9 pt-6 border-t border-border/70 flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition"
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
          className="btn-premium inline-flex items-center gap-1.5 h-11 px-6 rounded-xl font-semibold text-sm"
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

/**
 * A large, obviously-clickable choice tile.
 *
 * `disabled` is for options we can't teach yet rather than options that don't
 * exist. They stay visible so a student whose board is missing learns that
 * we know about it, instead of scanning a list and quietly concluding the app
 * is broken — hence the `description` doubling as the reason why.
 */
export function ChoiceTile({
  selected,
  onClick,
  title,
  description,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`group relative w-full text-left rounded-2xl border p-4 pr-10 transition duration-200 ${
        disabled
          ? "border-border bg-secondary/30 opacity-55 cursor-not-allowed"
          : selected
            ? "border-primary bg-primary/[0.07] ring-2 ring-primary/15 shadow-sm"
            : "border-border bg-background hover:border-primary/50 hover:shadow-sm hover:-translate-y-0.5"
      }`}
    >
      <div className={`font-semibold text-sm ${selected && !disabled ? "text-primary" : ""}`}>
        {title}
      </div>
      {description && (
        <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</div>
      )}
      {!disabled && (
        <span
          aria-hidden
          className={`absolute top-4 right-4 w-5 h-5 rounded-full flex items-center justify-center transition ${
            selected
              ? "bg-primary text-primary-foreground scale-100"
              : "border border-border scale-90 opacity-0 group-hover:opacity-100"
          }`}
        >
          <Check className="w-3 h-3" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
