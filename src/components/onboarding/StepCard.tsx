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
    <div className="pop-card pop-card-hero rise-in p-6 sm:p-8">
      <h1 className="font-display mb-1.5 text-2xl leading-tight font-extrabold tracking-tight sm:text-[1.75rem]">
        {title}
      </h1>
      {subtitle && <p className="text-muted-foreground mb-7 text-sm leading-relaxed">{subtitle}</p>}

      <div className="space-y-5">{children}</div>

      <div className="mt-9 pt-6 border-t border-border/70 flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="btn-soft inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-sm"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back
          </button>
        )}
        <div className="flex-1" />
        {onSkip && (
          <button type="button" onClick={onSkip} className="btn-ghost h-11 rounded-xl px-4 text-sm">
            Skip for now
          </button>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={continueDisabled || saving}
          className="btn-hero inline-flex h-11 items-center gap-1.5 rounded-xl px-6 text-sm"
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
      className={`group relative w-full rounded-2xl p-4 pr-10 text-left transition duration-200 ${
        disabled
          ? "border-border bg-secondary/30 cursor-not-allowed border opacity-55"
          : selected
            ? "surface-loud shadow-[var(--lift-2)]"
            : "pop-card pop-card-flat pop-card-interactive"
      }`}
    >
      <div
        className={`font-display text-sm font-bold ${selected && !disabled ? "text-[color:var(--tint)]" : ""}`}
      >
        {title}
      </div>
      {description && (
        <div className="text-muted-foreground mt-1 text-xs leading-relaxed">{description}</div>
      )}
      {!disabled && (
        <span
          aria-hidden
          className={`absolute top-4 right-4 flex size-5 items-center justify-center rounded-full transition ${
            selected
              ? "pop-in bg-[color:var(--tint)] text-white"
              : "border-border scale-90 border opacity-0 group-hover:opacity-100"
          }`}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
