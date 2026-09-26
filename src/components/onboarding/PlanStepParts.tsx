import { Mascot } from "@/components/Doodles";
import { Check, CreditCard, Clock, Mail, Pencil, GraduationCap } from "lucide-react";
import { formatPence } from "@/lib/billing/billing";
import { SUBJECTS, BOARDS, LEVELS } from "@/lib/curriculum/taxonomy";
import { CADENCES, type PlanStepState } from "./usePlanStep";

const labelFor = (list: readonly { value: string; label: string }[], value: string | null) =>
  list.find((x) => x.value === value)?.label ?? value ?? "";

/** Back from Stripe and the webhook has not landed within the window. Never the shop. */
export function PaymentStillConfirming({ onCheckAgain }: { onCheckAgain: () => void }) {
  return (
    <div className="pop-card pop-card-hero rise-in p-6 text-center sm:p-10">
      <Mascot name="rocket" mood="wow" size={96} className="mx-auto" />
      <h1 className="font-display mt-4 mb-2 text-2xl font-extrabold tracking-tight">
        Still confirming your payment
      </h1>
      <p className="text-sm">You don&apos;t need to pay again. It can take a minute to reach us.</p>
      <button
        type="button"
        onClick={onCheckAgain}
        className="btn-solid mt-6 inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold"
      >
        Check again
      </button>
    </div>
  );
}

/** Back from Stripe, waiting for the webhook. */
export function PaymentConfirming() {
  return (
    <div className="pop-card pop-card-hero rise-in p-6 text-center sm:p-10">
      <Mascot name="rocket" mood="wow" size={96} className="mx-auto" />
      <h1 className="font-display mt-4 mb-2 text-2xl font-extrabold tracking-tight">
        Confirming your payment…
      </h1>
      <p className="text-muted-foreground text-sm">
        This usually takes a couple of seconds. Don&apos;t close this tab.
      </p>
    </div>
  );
}

/** A paused or ending plan: resume it. Nothing is for sale here. */
export function PlanOnHold({
  onResume,
  onSignOut,
}: {
  onResume: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight mb-1">
          Your plan is on hold
        </h1>
        <p className="text-sm text-muted-foreground">
          You already have a plan with us — it's paused or set to end, not gone. Resume it and your
          dashboard, progress and history come straight back. There's nothing to buy again.
        </p>
      </div>
      <button
        type="button"
        onClick={onResume}
        className="btn-premium w-full h-12 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2"
      >
        <CreditCard className="w-4 h-4" /> Go to Billing and resume
      </button>
      <button
        type="button"
        onClick={onSignOut}
        className="w-full min-h-11 text-xs text-muted-foreground hover:text-foreground sm:min-h-0"
      >
        Sign out
      </button>
    </div>
  );
}

/** Summary — what they're buying, read from their enrolments. */
export function PlanSummary({
  level,
  subjectCount,
  enrolments,
  onEditSubjects,
}: Pick<PlanStepState, "level" | "subjectCount" | "enrolments"> & { onEditSubjects: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/50 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <GraduationCap className="w-3.5 h-3.5" />
          {labelFor(LEVELS, level)} · {subjectCount} {subjectCount === 1 ? "subject" : "subjects"}
        </div>
        <button
          type="button"
          onClick={onEditSubjects}
          className="tap-target inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Pencil className="w-3 h-3" /> Edit subjects
        </button>
      </div>
      <ul className="space-y-1.5">
        {enrolments.map((e) => (
          <li key={e.subject} className="flex items-center gap-2 text-sm">
            <Check className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="font-medium">{labelFor(SUBJECTS, e.subject)}</span>
            <span className="text-xs text-muted-foreground">{labelFor(BOARDS, e.board)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Cadence — the one thing left to choose. */
export function CadencePicker({
  cadence,
  setCadence,
  packageFor,
}: Pick<PlanStepState, "cadence" | "setCadence" | "packageFor">) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-2">
      {CADENCES.map((c) => {
        const pkg = packageFor(c.key);
        const on = cadence === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => setCadence(c.key)}
            className={`relative min-w-0 rounded-xl border p-2 text-center transition sm:p-3 ${
              on
                ? "border-primary bg-primary/[0.07] ring-2 ring-primary/15 shadow-sm"
                : "border-border bg-background hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-sm"
            }`}
          >
            {c.note && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
                {c.note}
              </span>
            )}
            <div className="text-xs font-semibold">{c.label}</div>
            <div className="mt-1 font-display font-bold">
              {pkg ? formatPence(pkg.price_pence) : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground">{c.unit}</div>
          </button>
        );
      })}
    </div>
  );
}

/** The compiled price. */
export function PlanTotal({
  selectedPkg,
  selectedUnit,
}: Pick<PlanStepState, "selectedPkg" | "selectedUnit">) {
  return (
    <div className="mt-4 flex items-end justify-between rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
      <div>
        <div className="text-xs text-muted-foreground">Total</div>
        <div className="font-display text-2xl font-bold">
          {selectedPkg ? formatPence(selectedPkg.price_pence) : "—"}
          <span className="text-sm font-medium text-muted-foreground"> {selectedUnit}</span>
        </div>
      </div>
      {selectedPkg?.description && (
        <p className="text-xs text-muted-foreground text-right max-w-[45%]">
          {selectedPkg.description}
        </p>
      )}
    </div>
  );
}

/** The other way through: the card belongs to a parent, so invite them to pay. */
export function AskParentCard({
  invited,
  parentEmail,
  setParentEmail,
  inviteParent,
  inviting,
}: Pick<
  PlanStepState,
  "invited" | "parentEmail" | "setParentEmail" | "inviteParent" | "inviting"
>) {
  return (
    <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in">
      <div className="flex items-center gap-2 mb-1">
        <Mail className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-display text-base font-bold">Not your card to use?</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Send your parent or guardian an invite. Once they link to your account, they can pay for you
        — your account unlocks the moment they do.
      </p>

      {invited ? (
        <div className="rounded-xl bg-muted/60 border border-border p-4 flex gap-3">
          <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <p className="font-semibold text-foreground mb-1">Invite sent to {parentEmail}</p>
            <p>
              They'll get an email with a link to join and pay. You can close this — sign back in
              any time and you'll come straight back here. We'll let you in as soon as payment
              lands.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-label="Parent or guardian's email"
            value={parentEmail}
            onChange={(e) => setParentEmail(e.target.value)}
            placeholder="parent@example.com"
            className="flex-1 min-w-0 h-11 rounded-xl bg-background border border-border px-3.5 text-sm transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
          <button
            type="button"
            onClick={inviteParent}
            disabled={inviting}
            className="h-11 px-4 rounded-xl border border-border text-sm font-semibold hover:border-primary/40 hover:text-primary transition disabled:opacity-50 shrink-0"
          >
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </div>
      )}
    </div>
  );
}
