import { Mascot } from "@/components/Doodles";
import { useState } from "react";
import { toast } from "sonner";
import {
  Atom,
  Check,
  Copy,
  CreditCard,
  Clock,
  FlaskConical,
  Leaf,
  Mail,
  Pencil,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { formatPence } from "@/lib/billing/billing";
import { subjectTint } from "@/lib/curriculum/subjectTheme";
import { SUBJECTS, BOARDS, LEVELS } from "@/lib/curriculum/taxonomy";
import { CADENCES, type PlanStepState } from "./usePlanStep";

const labelFor = (list: readonly { value: string; label: string }[], value: string | null) =>
  list.find((x) => x.value === value)?.label ?? value ?? "";

const SUBJECT_ICON: Record<string, LucideIcon> = {
  biology: Leaf,
  chemistry: FlaskConical,
  physics: Atom,
};

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
  paymentOverdue = false,
}: {
  onResume: () => void;
  onSignOut: () => void;
  /** The last payment failed, rather than the plan being paused or ending. */
  paymentOverdue?: boolean;
}) {
  return (
    <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight mb-1">
          {paymentOverdue ? "Your last payment didn't go through" : "Your plan is on hold"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {paymentOverdue
            ? "Your plan is still here — the card just needs updating. Once it's updated in Billing, your dashboard, progress and history come straight back. There's nothing to buy again."
            : "You already have a plan with us — it's paused or set to end, not gone. Resume it and your dashboard, progress and history come straight back. There's nothing to buy again."}
        </p>
      </div>
      <button
        type="button"
        onClick={onResume}
        className="btn-premium w-full h-12 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2"
      >
        <CreditCard className="w-4 h-4" />{" "}
        {paymentOverdue ? "Go to Billing and update the card" : "Go to Billing and resume"}
      </button>
      <button
        type="button"
        onClick={onSignOut}
        className="w-full min-h-11 text-xs text-muted-foreground hover:text-foreground sm:pointer-fine:min-h-0"
      >
        Sign out
      </button>
    </div>
  );
}

/** Back to step 3, to change what the plan is built from. */
export function EditSubjectsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-soft inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-sm sm:pointer-fine:h-10"
    >
      <Pencil className="size-3.5" aria-hidden /> Edit subjects
    </button>
  );
}

/** Summary — what they're buying, read from their enrolments. One line a subject. */
export function PlanSummary({ level, enrolments }: Pick<PlanStepState, "level" | "enrolments">) {
  const levelLabel = labelFor(LEVELS, level);
  return (
    <ul className="space-y-2">
      {enrolments.map((e) => {
        const Icon = SUBJECT_ICON[e.subject] ?? GraduationCap;
        const subject = labelFor(SUBJECTS, e.subject);
        return (
          <li key={e.subject} className={`flex items-center gap-2.5 ${subjectTint(e.subject)}`}>
            <span className="icon-tile size-9 shrink-0">
              <Icon className="size-4.5" aria-hidden />
            </span>
            <span className="text-lg font-bold">
              {/* "GCSE Chemistry", but the trilogy label already ends in a bracket. */}
              {level === "gcse_trilogy" ? `${levelLabel}: ${subject}` : `${levelLabel} ${subject}`}
              {e.board && (
                <span className="text-[color:var(--tint)]"> · {labelFor(BOARDS, e.board)}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Cadence — the one thing left to choose, as one segmented row. */
export function CadencePicker({
  cadence,
  setCadence,
}: Pick<PlanStepState, "cadence" | "setCadence">) {
  return (
    <div className="tab-row mt-7 flex w-full" role="radiogroup" aria-label="How often to pay">
      {CADENCES.map((c) => {
        const on = cadence === c.key;
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={on}
            data-active={on}
            onClick={() => setCadence(c.key)}
            className="tab-item min-h-11 flex-1 flex-wrap justify-center gap-x-2 gap-y-1 text-[0.9375rem]"
          >
            {c.label}
            {c.note && <span className="chip chip-solid whitespace-nowrap">{c.note}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Tick({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-[0.9375rem] font-medium">
      <span className="icon-tile icon-tile-solid tint-emerald size-5 shrink-0 rounded-full">
        <Check className="size-3" strokeWidth={3} aria-hidden />
      </span>
      {children}
    </li>
  );
}

/** The compiled price, large, and what it buys. */
export function PlanTotal({
  selectedPkg,
  selectedUnit,
}: Pick<PlanStepState, "selectedPkg" | "selectedUnit">) {
  return (
    <>
      <div className="mt-8 flex flex-wrap items-baseline justify-center gap-x-2">
        <span className="numeral text-5xl sm:text-6xl">
          {selectedPkg ? formatPence(selectedPkg.price_pence) : "—"}
        </span>
        {/* "a month" beside a price this size; "per month" is for a line of text. */}
        <span className="font-display text-xl font-bold">
          {selectedUnit.replace(/^per /, "a ")}
        </span>
      </div>
      <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
        {selectedPkg?.description && <Tick>{selectedPkg.description.replace(/\.$/, "")}</Tick>}
        <Tick>Unlocks straight away</Tick>
        <Tick>Cancel anytime</Tick>
      </ul>
    </>
  );
}

/** The other way through: the card belongs to a parent, so invite them to pay. */
export function AskParentCard({
  inviteOutcome,
  setInviteOutcome,
  inviteCode,
  parentEmail,
  setParentEmail,
  inviteParent,
  inviting,
}: Pick<
  PlanStepState,
  | "inviteOutcome"
  | "setInviteOutcome"
  | "inviteCode"
  | "parentEmail"
  | "setParentEmail"
  | "inviteParent"
  | "inviting"
>) {
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated; the code is on screen to read either way.
      toast.error("Could not copy — select the code and copy it manually.");
    }
  };

  return (
    <div className="premium-card rounded-3xl p-6 sm:p-8 rise-in">
      <div className="flex items-center gap-3">
        <span className="icon-tile size-10 shrink-0">
          <Mail className="size-5" aria-hidden />
        </span>
        <h2 className="text-lg font-bold">Not your card to use?</h2>
      </div>
      <p className="mt-3 mb-5 text-[0.9375rem] leading-relaxed">
        Send your parent or guardian an invite. Once they link to your account, they can pay for you
        — your account unlocks the moment they do.
      </p>

      {/* Nothing here sends an email. An existing parent gets a request in their
          account; anyone else needs the student's code, so say which happened. */}
      {inviteOutcome === "invited" ? (
        <div className="premium-card pop-card-flat flex gap-3 rounded-2xl p-4">
          <span className="icon-tile size-9 shrink-0">
            <Clock className="size-4" aria-hidden />
          </span>
          <div className="text-[0.9375rem] leading-relaxed">
            <p className="font-bold mb-1">Request sent to {parentEmail}</p>
            <p>
              It&apos;s waiting in their account — they&apos;ll see it next time they sign in, and
              can pay for you once they accept. You can close this — sign back in any time and
              you&apos;ll come straight back here. We&apos;ll let you in as soon as payment lands.
            </p>
          </div>
        </div>
      ) : inviteOutcome === "no_account" ? (
        <div className="premium-card pop-card-flat rounded-2xl p-4 space-y-3">
          <div className="text-[0.9375rem] leading-relaxed">
            <p className="font-bold mb-1">No account uses {parentEmail} yet</p>
            <p>
              Send them your invite code. They sign up as a parent, enter the code, and are linked
              to you straight away — then they can pay.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="premium-input flex-1 min-w-40 h-11 px-3.5 flex items-center font-mono text-base font-bold tracking-widest">
              {inviteCode ?? "—"}
            </code>
            <button
              type="button"
              onClick={copyCode}
              disabled={!inviteCode}
              className="btn-soft h-11 px-4 rounded-xl text-sm inline-flex items-center gap-2"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setInviteOutcome(null)}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline sm:pointer-fine:min-h-0"
          >
            Try a different email
          </button>
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
            className="premium-input flex-1 min-w-0 h-11 px-3.5 text-[0.9375rem]"
          />
          <button
            type="button"
            onClick={inviteParent}
            disabled={inviting}
            className="btn-soft h-11 px-4 rounded-xl text-sm shrink-0"
          >
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </div>
      )}
    </div>
  );
}
