import { useMemo, useState } from "react";
import { Loader2, Plus, Sparkles, TrendingUp, Check } from "lucide-react";
import { toast } from "sonner";
import { SUBJECTS, BOARDS, type BoardV } from "@/lib/taxonomy";
import { usePackages, useAddSubjects } from "@/hooks/data/useBilling";
import { formatPence } from "@/lib/billing";
import {
  planCadence,
  planSubjectCount,
  tierFor,
  CADENCES,
  PLAN_MAX_SUBJECTS,
} from "@/lib/entitlements";

interface AddSubjectCardProps {
  /** subscriptions.student_id whose plan is being grown. */
  studentId: string;
  /** The student's current plan tier, e.g. "monthly_1". */
  currentTier: string;
  /** Subjects already on the plan (won't be offered again). */
  enrolledSubjects: string[];
  /** Board to pre-fill new subjects with (their existing board). */
  defaultBoard?: BoardV;
  /** Whose plan it is ("Alex"), for the parent view. Omit for own plan. */
  ownerLabel?: string;
}

/**
 * The frictionless upgrade: add another subject to a live plan without leaving
 * the billing page. Same cadence, one step up the subject-count ladder, prorated
 * and charged now. Deliberately a soft upsell — a premium card with a live price
 * delta and a light nudge, not a hard paywall.
 *
 * Renders nothing when there's nothing to sell (plan already covers all three
 * subjects, or the tier isn't one we can upgrade automatically).
 */
export function AddSubjectCard({
  studentId,
  currentTier,
  enrolledSubjects,
  defaultBoard = "edexcel",
  ownerLabel,
}: AddSubjectCardProps) {
  const { data: packages = [] } = usePackages();
  const add = useAddSubjects();

  const cadence = planCadence(currentTier);
  const currentCount = planSubjectCount(currentTier);
  const remaining = PLAN_MAX_SUBJECTS - enrolledSubjects.length;

  const available = SUBJECTS.filter((s) => !enrolledSubjects.includes(s.value));
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [boards, setBoards] = useState<Record<string, BoardV>>({});

  const chosen = available.filter((s) => picked[s.value]);
  const newCount = enrolledSubjects.length + chosen.length;

  const priceOf = (tier: string) => packages.find((p) => p.tier === tier)?.price_pence ?? null;
  const unit = CADENCES.find((c) => c.key === cadence)?.unit ?? "";

  const delta = useMemo(() => {
    if (!cadence || chosen.length === 0) return null;
    const now = priceOf(tierFor(cadence, currentCount));
    const next = priceOf(tierFor(cadence, newCount));
    if (now == null || next == null) return null;
    return next - now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadence, chosen.length, currentCount, newCount, packages]);

  // Nothing to sell — don't render the card at all.
  if (!cadence || available.length === 0 || remaining <= 0) return null;

  const whose = ownerLabel ? `${ownerLabel}'s` : "your";
  const atCapacity = chosen.length >= remaining;

  const toggle = (value: string) => {
    setPicked((prev) => {
      const next = { ...prev, [value]: !prev[value] };
      // Respect the 3-subject ceiling: block turning on more than remaining.
      if (!prev[value] && Object.values(next).filter(Boolean).length > remaining) return prev;
      return next;
    });
    setBoards((prev) => (prev[value] ? prev : { ...prev, [value]: defaultBoard }));
  };

  const submit = () => {
    if (chosen.length === 0) return;
    add.mutate(
      {
        studentId,
        subjects: chosen.map((s) => ({ subject: s.value, board: boards[s.value] ?? defaultBoard })),
      },
      {
        onSuccess: (res) => {
          setPicked({});
          toast.success(
            `Added ${res.added.length === 1 ? "1 subject" : `${res.added.length} subjects`} — ${whose} access is unlocked.`,
          );
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
      {/* soft glow accent */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold">Add another subject</h3>
        </div>
        <p className="text-sm text-muted-foreground max-w-md">
          The same expert tutoring across more of {whose} sciences. You only pay the difference,
          prorated from today — nothing changes about how often you're billed.
        </p>

        {currentCount === 1 && (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
            <TrendingUp className="w-3.5 h-3.5" /> Most students study 2 or more subjects with us
          </div>
        )}

        <div className="mt-5 space-y-2">
          {available.map((s) => {
            const on = !!picked[s.value];
            const disabled = !on && atCapacity;
            return (
              <div
                key={s.value}
                className={`rounded-xl border p-3.5 transition ${
                  on ? "border-primary bg-primary/10" : "border-border bg-card"
                } ${disabled ? "opacity-50" : ""}`}
              >
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {on && <Check className="w-3.5 h-3.5" />}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    disabled={disabled}
                    onChange={() => toggle(s.value)}
                  />
                  <span className="text-sm font-semibold flex-1">{s.label}</span>
                </label>

                {on && (
                  <div className="mt-2.5 pl-8 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Exam board</span>
                    <select
                      value={boards[s.value] ?? defaultBoard}
                      onChange={(e) =>
                        setBoards((prev) => ({ ...prev, [s.value]: e.target.value as BoardV }))
                      }
                      className="h-8 rounded-lg bg-card border border-border px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {BOARDS.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {chosen.length > 0 && delta != null && (
          <div className="mt-4 flex items-end justify-between rounded-xl border border-border bg-muted/40 p-4">
            <div>
              <div className="text-xs text-muted-foreground">Added to your plan</div>
              <div className="font-display text-2xl font-bold text-primary">
                +{formatPence(delta)}
                <span className="text-sm font-medium text-muted-foreground"> {unit}</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground text-right max-w-[45%]">
              Charged prorated today; then {formatPence(priceOf(tierFor(cadence, newCount)) ?? 0)}{" "}
              {unit} from your next bill.
            </p>
          </div>
        )}

        <button
          onClick={submit}
          disabled={chosen.length === 0 || add.isPending}
          className="mt-4 w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 text-sm shadow-sm inline-flex items-center justify-center gap-2"
        >
          {add.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Adding…
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              {chosen.length === 0
                ? "Choose a subject to add"
                : `Add ${chosen.length === 1 ? "1 subject" : `${chosen.length} subjects`}${
                    delta != null ? ` — +${formatPence(delta)} ${unit}` : ""
                  }`}
            </>
          )}
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground text-center">
          Secure proration by Stripe. The new subject unlocks the moment payment clears.
        </p>
      </div>
    </div>
  );
}
